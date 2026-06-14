from app.database.connection import Base, engine
from app.database import models

def init_db():
    Base.metadata.create_all(bind=engine)