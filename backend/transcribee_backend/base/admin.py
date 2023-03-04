from django.contrib import admin

from .models import Document, DocumentUpdate, User

admin.register(User)
admin.register(Document)
admin.register(DocumentUpdate)
