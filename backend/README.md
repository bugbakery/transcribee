# transcribee-backend

This folder contains the backend of transcribee.

## Installation

We use uv for dependency management. To install all dependencies locally, run:

```shell
uv sync --dev
```

## Usage

The default development configuration uses a sqlite database in `db.sqlite3`. To set up the
database, run all migrations with

```shell
poe migrate
```

To create a new admin user, you can now run:

```shell
poe admin create_user --user admin --pass admin
```

Now you can start the development server with

```shell
poe dev
```

## Deployment

> **Warning**
> The setup is not ready for production deployment yet.
