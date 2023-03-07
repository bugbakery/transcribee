from django.contrib import admin

from .models import Document, DocumentUpdate, Task, User, Worker

admin.site.register(User)
admin.site.register(Document)
admin.site.register(DocumentUpdate)

admin.site.register(Worker)
admin.site.register(Task)
