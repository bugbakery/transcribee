from django.contrib import admin

from .models import Document, DocumentUpdate, Task, User, Worker


@admin.action(description="Requeue task")
def requeue(modeladmin, request, queryset):
    for task in queryset.select_for_update():
        task.completed = False
        task.completed_at = None
        task.assigned_worker = None
        task.save()


class TaskAdmin(admin.ModelAdmin):
    list_display = ["document", "task_type", "completed", "dependencies"]
    actions = [requeue]

    def dependencies(self, obj):
        return [dep for dep in obj.dependency.all()]


admin.site.register(User)
admin.site.register(Document)
admin.site.register(DocumentUpdate)

admin.site.register(Worker)
admin.site.register(Task, TaskAdmin)
