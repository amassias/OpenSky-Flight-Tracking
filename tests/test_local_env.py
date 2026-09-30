import os

from local_env import load_local_env


def test_pulled_vercel_system_variables_do_not_leak_into_local_runs(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        'VERCEL="1"\nVERCEL_ENV="production"\nOPEN_SKY_CLIENT_ID="client"\nOPEN_SKY_CLIENT_SECRET="secret"\n'
    )
    for key in ("VERCEL", "VERCEL_ENV", "OPEN_SKY_CLIENT_ID", "OPEN_SKY_CLIENT_SECRET"):
        monkeypatch.delenv(key, raising=False)

    load_local_env(env_file)

    assert "VERCEL" not in os.environ
    assert "VERCEL_ENV" not in os.environ
    assert os.environ["OPEN_SKY_CLIENT_ID"] == "client"
    assert os.environ["OPEN_SKY_CLIENT_SECRET"] == "secret"


def test_real_environment_wins_over_env_file(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text('OPEN_SKY_CLIENT_ID="from-file"\n')
    monkeypatch.setenv("OPEN_SKY_CLIENT_ID", "from-shell")

    load_local_env(env_file)

    assert os.environ["OPEN_SKY_CLIENT_ID"] == "from-shell"
