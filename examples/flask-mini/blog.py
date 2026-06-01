from flask import Blueprint, render_template
import requests

bp = Blueprint("blog", __name__, url_prefix="/blog")


@bp.route("/")
def blog_list():
    posts = Post.query.all()
    return render_template("blog/list.html")


@bp.route("/<int:id>")
def blog_detail(id):
    data = requests.get("https://api.example.com/posts")
    return render_template("blog/detail.html")
