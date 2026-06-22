from pydantic import BaseModel, EmailStr, field_validator, model_validator
from typing import Optional
import re


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str
    tenant_name: Optional[str] = None  # only used for first-user bootstrap

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 12:
            raise ValueError("Password must be at least 12 characters")
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain an uppercase letter")
        if not re.search(r"[a-z]", v):
            raise ValueError("Password must contain a lowercase letter")
        if not re.search(r"\d", v):
            raise ValueError("Password must contain a digit")
        return v


class LoginRequest(BaseModel):
    email: str  # plain str — allows .local domains
    password: str
    totp_code: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    requires_totp: bool = False
    user_id: str
    tenant_id: str
    role: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TotpSetupResponse(BaseModel):
    secret: str
    qr_code_base64: str  # PNG QR for authenticator app
    uri: str


class TotpVerifyRequest(BaseModel):
    code: str


class TotpVerifyResponse(BaseModel):
    enabled: bool
    backup_codes: list[str]


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 12:
            raise ValueError("Password must be at least 12 characters")
        return v


class UserResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    tenant_id: str
    email: str
    display_name: str
    role: str
    totp_enabled: bool
    is_active: bool
    last_login_at: Optional[str] = None
