from flask import Flask, render_template, redirect, url_for
import requests
from blog import bp

app = Flask(__name__)
app.register_blueprint(bp)


@app.route("/")
def home():
    return render_template("home.html")


@app.route("/about")
def about():
    if not logged_in():
        return redirect(url_for("home"))
    return render_template("about.html")
