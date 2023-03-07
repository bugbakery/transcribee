# Task Protocol

Transcribee implements a very simple protocol to coordinate work for the workers.

## Frontend

### Submit task (frontend)

Tasks can be scheduled by the frontend with the following call.
Tasks may be scheduled in other ways, for example automatically by the backend.

```
POST /api/v1/tasks/

{
    "document": [ID],
    "task_type": "DIARIZE",
    "task_parameters":{"speaker_counter":42},
}
```

## Worker

Workers have a token.
How the token is obtained is not part of this protocol.
The token MUST be send in the authorize header with the `Worker` prefix to authenticate the worker.

### Claim task

If a worker wants a new task, it sends the following request to the backend.
The backend checks if a new task is available.
It only checks for tasks of the types submitted in the `task_type` query parameter.

If a task is available, the backend assigns the worker to the tasks and returns the task.

If no task is available, the backend replies with a json `null`.

```
POST /api/v1/tasks/claim_unassigned_task?task_type=DIARIZE,ALIGN

Authorize: Worker [TOKEN]
```

Reponse body:

```json
{
    "document": [ID],
    "task_type": "DIARIZE",
    "task_parameters":{"speaker_counter":42},
}
```

OR

```json
null
```

## Keep alive / progress

Worker MUST send the following request to the backend periodically.

It MAY contain the "progress" field to update the progress of the task.

> **Warning**
> Even if the progress is not updated, the worker MUST perform the update often.
> Otherwise the task may be reschedules to another worker.

```
PATCH /api/v1/tasks/[ID]/keepalive/

Authorize: Worker [TOKEN]

{
    "progress": 0.1
}
```
