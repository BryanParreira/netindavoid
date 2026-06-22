from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class TrafficPoint(BaseModel):
    ts: datetime
    bytes_in: int
    bytes_out: int
    device_id: Optional[str] = None


class BandwidthSummary(BaseModel):
    total_bytes_in: int
    total_bytes_out: int
    peak_mbps_in: float
    peak_mbps_out: float
    current_mbps_in: float
    current_mbps_out: float


class TopTalker(BaseModel):
    device_id: str
    device_name: str
    bytes_in: int
    bytes_out: int
    total_bytes: int
    percentage: float


class TrafficOverviewResponse(BaseModel):
    summary: BandwidthSummary
    top_talkers: list[TopTalker]
    timeseries: list[TrafficPoint]
