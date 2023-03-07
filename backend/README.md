# transcribee-backend

This folder contains the backend of transcribee.

## Installation

We use pdm for dependency management. To install all dependencies locally, run:

```shell
pdm install
```

## Usage

The default development configuration uses a sqlite database in `db.sqlite3`. To setup the database, run all migrations with

```shell
pdm run python manage.py migrate
```

Now you can start the development server with

```shell
pdm run dev
```

### Initial data

Now create a user by going to http://localhost:8000/api/v1/users/ and filling out the form.
After that you can create a document by going to http://localhost:8000/api/v1/documents/ and filling out the form

## Deployment

> **Warning**
> The setup is not ready for production deployment yet. See the [django deployment checklist](https://docs.djangoproject.com/en/4.1/howto/deployment/checklist/)
