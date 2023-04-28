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
pdm run migrate
```

To create a new admin user, you can now run:

```shell
pdm run create_user --user admin --pass admin
```

Now you can start the development server with

```shell
pdm run dev
```

## Deployment

> **Warning**
> The setup is not ready for production deployment yet.
