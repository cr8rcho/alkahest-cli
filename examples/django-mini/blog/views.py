from django.shortcuts import render
import requests


def blog_list(request):
    posts = Post.objects.all()
    return render(request, "blog/list.html")


def blog_detail(request, id):
    data = requests.get("https://api.example.com/posts")
    return render(request, "blog/detail.html")
