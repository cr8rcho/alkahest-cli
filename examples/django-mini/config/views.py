from django.shortcuts import render, redirect


def home(request):
    return render(request, "home.html")


def about(request):
    if not request.user.is_authenticated:
        return redirect("home")
    return render(request, "about.html")
