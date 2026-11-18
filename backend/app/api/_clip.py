"""BaseModel that truncates over-long str fields to their max_length instead of rejecting the request.

Scraped statement text (fund names with folios, OCR blobs) can exceed a limit; a 422 here blocks the whole report."""
from pydantic import BaseModel, model_validator


class ClipModel(BaseModel):
    @model_validator(mode="before")
    @classmethod
    def _clip(cls, data):
        if not isinstance(data, dict):
            return data
        data = dict(data)
        for k, f in cls.model_fields.items():
            m = next((x.max_length for x in f.metadata if getattr(x, "max_length", None)), None)
            v = data.get(k)
            if m and isinstance(v, str) and len(v) > m:
                data[k] = " ".join(v.split())[:m].rstrip()
        return data
