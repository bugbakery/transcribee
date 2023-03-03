from django.contrib import admin
from .models import User, Document, DocumentUpdate

admin.register(User)
admin.register(Document)
admin.register(DocumentUpdate)
