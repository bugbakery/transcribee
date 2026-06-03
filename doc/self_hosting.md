# Self-Hosting transcribee-web

In this document you can find information on how to test transcribee locally and how to self-host
transcribee-web for an organization like a university department or research-group.
Doing so requires some technical expertise.

## Just Trying Things Out

If you just want to try out transcribee on your local machine, follow the steps outlined here:
1. clone this repository to some place on your computer by running
   ```sh
   git clone https://github.com/bugbakery/transcribee && cd transcribee
   ```
2. make sure you have installed `docker` on your system and run
   ```sh
   docker compose -f packaging/compose-local.yml up
   ```
3. Wait for transcribee to start
4. Point your webbrowser to `http://localhost:8000` and log in with username and password "test"
5. Profit

## Real Deployments

If you want to deploy transcribee-web on a server that is accessible over the internet to multiple
people you need a server on which you can run `docker` containers, a domain (or a subdomain) that
you can use for your transcribee-web installation and a reverse-proxy for terminating https.

For your setup you can also use the [`compose-deploy.yml`](../packaging/compose-deploy.yml) docker
compose file as a starting point.

After setting everything up, you can create users for your instance using the transcribee-admin cli:
```sh
docker compose exec backend transcribee-admin create_user --user username@example.com
```

### Add More Workers

For performance reasons, you might want to run more workers (e.g. on more powerful hardware with a gpu).
These do not need to be on the same network as your server and talk to your transcribee instance via
ordinary https.

To add a new worker you first create a new worker token:

```sh
docker compose exec backend transcribee-admin create_worker --name "Your Worker Name" --token "INSERT_RANDOM_WORKER_TOKEN"
```

You can then run the worker (on your worker machine) with

```sh
docker run ghcr.io/bugbakery/transcribee-worker:latest --coordinator https://your-transcribee-instance.net --token INSERT_RANDOM_WORKER_TOKEN
```
