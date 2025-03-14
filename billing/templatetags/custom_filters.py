from django import template

register = template.Library()


@register.filter
def split(value, arg):
    """
    Splits a string and returns a list.
    """
    return value.split(arg)
