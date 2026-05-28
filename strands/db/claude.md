### Database

Postgres 16 runs in Docker Compose as the `db` service. Connect locally with `psql -h localhost -p $PG_PORT -U app -d app` (password `app`). The data volume is under `~/.strand-data/{{projectName}}/postgres/` and persists across `strand stop` / `strand dev`. To wipe it, stop the project and `rm -rf` the directory.
