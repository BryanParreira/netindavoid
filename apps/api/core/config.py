from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AnyHttpUrl, field_validator
from typing import List
import secrets


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    APP_ENV: str = "development"
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    FRONTEND_URL: str = "http://localhost:3000"
    ALLOWED_ORIGINS: str = "http://localhost:3000"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://netindavoid:changeme@postgres:5432/netindavoid"

    # Redis
    REDIS_URL: str = "redis://redis:6379/0"
    CELERY_BROKER_URL: str = "redis://redis:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://redis:6379/2"

    # JWT
    JWT_SECRET_KEY: str = secrets.token_hex(32)
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Fernet encryption (router creds, secrets at rest)
    FERNET_KEY: str = ""

    # TOTP
    TOTP_ISSUER_NAME: str = "Vex"

    # AI
    AI_SERVICE_URL: str = "http://ai-service:8001"
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3.2"
    ANTHROPIC_API_KEY: str = ""

    # Network scanning
    SCAN_NETWORK_CIDR: str = "192.168.1.0/24"
    SCAN_INTERVAL_SECONDS: int = 60
    OUI_DB_PATH: str = "/app/data/oui.txt"
    NMAP_SUDO: bool = False  # True after running scripts/setup-nmap-sudo.sh for OS detection

    # Suricata
    SURICATA_EVE_LOG_PATH: str = "/var/log/suricata/eve.json"

    # Pi-hole
    PIHOLE_API_URL: str = ""
    PIHOLE_API_KEY: str = ""

    # Bootstrap admin
    ADMIN_EMAIL: str = "admin@vex.local"
    ADMIN_PASSWORD: str = "changeme"
    ADMIN_TENANT_NAME: str = "Home Network"

    # Log ingestion
    HEC_TOKEN: str = secrets.token_urlsafe(32)  # Splunk-compatible HTTP Event Collector token

    # Notifications
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "alerts@vex.local"
    SLACK_WEBHOOK_URL: str = ""
    DISCORD_WEBHOOK_URL: str = ""

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",")]

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"


settings = Settings()
