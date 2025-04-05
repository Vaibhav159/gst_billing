from django.shortcuts import render


def index(request, *args, **kwargs):
    """
    Render the React app
    """
    return render(request, "frontend/index.html")
