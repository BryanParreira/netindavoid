from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, timezone
import uuid
import json

from core.database import get_db
from core.security import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    decode_token, generate_totp_secret, generate_totp_qr, get_totp_uri,
    verify_totp, generate_backup_codes, hash_password
)
from core.deps import get_current_user
from middleware.rate_limit import limiter
from models.user import User, UserRole
from models.tenant import Tenant
from models.audit_log import AuditLog
from schemas.auth import (
    RegisterRequest, LoginRequest, TokenResponse, RefreshRequest,
    TotpSetupResponse, TotpVerifyRequest, TotpVerifyResponse,
    UserResponse, ChangePasswordRequest
)

router = APIRouter(prefix="/auth", tags=["auth"])


async def _log_action(db: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID | None,
                       action: str, request: Request, success: bool = True, **meta) -> None:
    log = AuditLog(
        tenant_id=tenant_id,
        user_id=user_id,
        action=action,
        occurred_at=datetime.now(timezone.utc),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        metadata=meta or None,
        success=success,
    )
    db.add(log)


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def register(request: Request, body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # Only allow registration if no users exist yet (self-hosted bootstrap)
    count = await db.execute(select(func.count(User.id)))
    if count.scalar() > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration is closed. Contact your administrator."
        )

    # Create tenant
    slug = (body.tenant_name or "home-network").lower().replace(" ", "-")
    tenant = Tenant(name=body.tenant_name or "Home Network", slug=slug)
    db.add(tenant)
    await db.flush()

    # Create admin user
    user = User(
        tenant_id=tenant.id,
        email=body.email,
        display_name=body.display_name,
        hashed_password=hash_password(body.password),
        role=UserRole.ADMIN,
    )
    db.add(user)
    await db.flush()

    await _log_action(db, tenant.id, user.id, "user.register", request)

    return TokenResponse(
        access_token=create_access_token(str(user.id), {"tenant_id": str(tenant.id), "role": user.role}),
        refresh_token=create_refresh_token(str(user.id)),
        user_id=str(user.id),
        tenant_id=str(tenant.id),
        role=user.role,
    )


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email, User.is_active == True))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # 2FA check
    if user.totp_enabled:
        if not body.totp_code:
            # Signal frontend to show TOTP field
            return TokenResponse(
                access_token="",
                refresh_token="",
                requires_totp=True,
                user_id=str(user.id),
                tenant_id=str(user.tenant_id),
                role=user.role,
            )
        if not verify_totp(user.totp_secret, body.totp_code):
            # Check backup codes
            if not _check_backup_code(user, body.totp_code):
                await _log_action(db, user.tenant_id, user.id, "user.login.totp_fail", request, success=False)
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid 2FA code")

    user.last_login_at = datetime.now(timezone.utc)
    user.last_login_ip = request.client.host if request.client else None

    await _log_action(db, user.tenant_id, user.id, "user.login", request)

    return TokenResponse(
        access_token=create_access_token(str(user.id), {"tenant_id": str(user.tenant_id), "role": user.role}),
        refresh_token=create_refresh_token(str(user.id)),
        user_id=str(user.id),
        tenant_id=str(user.tenant_id),
        role=user.role,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise ValueError("Wrong token type")
        user_id = uuid.UUID(payload["sub"])
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return TokenResponse(
        access_token=create_access_token(str(user.id), {"tenant_id": str(user.tenant_id), "role": user.role}),
        refresh_token=create_refresh_token(str(user.id)),
        user_id=str(user.id),
        tenant_id=str(user.tenant_id),
        role=user.role,
    )


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)):
    return UserResponse(
        id=str(user.id),
        tenant_id=str(user.tenant_id),
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        totp_enabled=user.totp_enabled,
        is_active=user.is_active,
        last_login_at=user.last_login_at.isoformat() if user.last_login_at else None,
    )


@router.post("/totp/setup", response_model=TotpSetupResponse)
async def setup_totp(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.totp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="2FA already enabled")
    secret = generate_totp_secret()
    user.totp_secret = secret
    return TotpSetupResponse(
        secret=secret,
        qr_code_base64=generate_totp_qr(secret, user.email),
        uri=get_totp_uri(secret, user.email),
    )


@router.post("/totp/verify", response_model=TotpVerifyResponse)
async def verify_totp_setup(
    body: TotpVerifyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Run /totp/setup first")
    if not verify_totp(user.totp_secret, body.code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid code")

    user.totp_enabled = True
    codes = generate_backup_codes()
    user.backup_codes = json.dumps([hash_password(c) for c in codes])

    return TotpVerifyResponse(enabled=True, backup_codes=codes)


@router.delete("/totp", status_code=status.HTTP_204_NO_CONTENT)
async def disable_totp(
    body: TotpVerifyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.totp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="2FA not enabled")
    if not verify_totp(user.totp_secret, body.code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid code")

    user.totp_enabled = False
    user.totp_secret = None
    user.backup_codes = None


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password incorrect")
    user.hashed_password = hash_password(body.new_password)
    await _log_action(db, user.tenant_id, user.id, "user.password_change", request)


def _check_backup_code(user: User, code: str) -> bool:
    if not user.backup_codes:
        return False
    stored = json.loads(user.backup_codes)
    from core.security import verify_password as vp
    for i, hashed in enumerate(stored):
        if vp(code.upper(), hashed):
            stored.pop(i)
            user.backup_codes = json.dumps(stored)
            return True
    return False
