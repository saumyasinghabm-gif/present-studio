from sqlalchemy.orm import Session
from .models import Presentation, Slide, User
from .security import hash_password


DEMO_USER_ID = "usr_demo"


def default_canvas(title: str, subtitle: str) -> dict:
    return {
        "background": "#f8f4ea",
        "elements": [
            {
                "id": "title",
                "type": "text",
                "text": title,
                "x": 18,
                "y": 30,
                "width": 64,
                "fontSize": 56,
                "fontWeight": "600",
                "color": "#171717",
                "textAlign": "center",
            },
            {
                "id": "subtitle",
                "type": "text",
                "text": subtitle,
                "x": 24,
                "y": 52,
                "width": 52,
                "fontSize": 24,
                "fontWeight": "500",
                "color": "#7a653c",
                "textAlign": "center",
            },
        ],
    }


def seed_demo_data(db: Session) -> None:
    if db.get(User, DEMO_USER_ID):
        return

    user = User(
        id=DEMO_USER_ID,
        name="Studio Owner",
        email="owner@presentstudio.local",
        password_hash=hash_password("password123"),
        role="owner",
    )
    presentation = Presentation(id="pres_demo", title="Product Vision Deck", owner_id=DEMO_USER_ID)
    slides = [
        Slide(id="slide_1", presentation_id="pres_demo", order=1, title="Present Studio Cloud", canvas=default_canvas("Present Studio Cloud", "Create, share, and present from one workspace")),
        Slide(id="slide_2", presentation_id="pres_demo", order=2, title="Live Presentation", canvas=default_canvas("Live Presentation", "Presenter controls and audience links")),
        Slide(id="slide_3", presentation_id="pres_demo", order=3, title="Canvas Builder", canvas=default_canvas("Canvas Builder", "Slide JSON that your backend stores safely")),
    ]
    db.add(user)
    db.add(presentation)
    db.add_all(slides)
    db.commit()
