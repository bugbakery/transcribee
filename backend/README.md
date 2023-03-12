# transcribee-backend

This folder contains the backend of transcribee.

## Installation

We use pdm for dependency management. To install all dependencies locally, run:

```shell
pdm install
```

## Usage

The default development configuration uses a sqlite database in `db.sqlite3`. To set up the
database, run all migrations with

```shell
pdm run manage migrate
```

To create a new admin user, you can now run:

```shell
pdm run manage create_superuser_if_not_exists --user test --pass test

```

Now you can start the development server with

```shell
pdm run dev
```

## Deployment

> **Warning**
> The setup is not ready for production deployment yet. See the
> [django deployment checklist](https://docs.djangoproject.com/en/4.1/howto/deployment/checklist/)
