import json
import logging

import uvicorn

from .api import create_app
from .settings import Settings


class JsonFormatter(logging.Formatter):
    def format(self, record):
        return json.dumps({"level": record.levelname, "event": record.getMessage(),
                           "error_type": getattr(record, "error_type", None)})


if __name__ == "__main__":
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    logging.getLogger("spff_ai").addHandler(handler)
    logging.getLogger("spff_ai").setLevel(logging.INFO)
    settings = Settings.load()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, access_log=False)
