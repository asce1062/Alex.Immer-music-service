#!/usr/bin/env python3
"""Generate Client Secrets for Music Service API

This script generates cryptographically secure random secrets for client authentication.
Use these secrets to populate AWS Secrets Manager after running terraform apply.

Usage:
    python scripts/generate_client_secrets.py

Output:
    Displays client ID and generated secret for each client.
    Copy these values to AWS Secrets Manager.
"""

import json
import secrets
from datetime import datetime


def generate_client_secret(length: int = 64) -> str:
    """Generate a cryptographically secure random secret."""
    return secrets.token_urlsafe(length)


def main():
    """Generate secrets for all clients."""
    clients = [
        {
            "client_id": "alexmbugua-personal",
            "description": "Personal portfolio/blog music player",
            "allowed_origins": [
                "https://alexmbugua.me",
                "https://www.alexmbugua.me",
                "https://alexmbugua.netlify.app",
                "http://localhost:4321",
                "http://localhost:4322",
                "http://localhost:8888",
                "http://127.0.0.1:4321",
                "http://127.0.0.1:4322",
                "http://127.0.0.1:8888",
            ],
        },
        {
            "client_id": "music-app-web",
            "description": "Dedicated music web application",
            "allowed_origins": [
                "https://asce1062.github.io",
                "https://music.alexmbugua.me",
                "http://localhost:4321",
                "http://localhost:4322",
                "http://127.0.0.1:4321",
                "http://127.0.0.1:4322",
            ],
        },
        {
            "client_id": "alex-immer-mobile",
            "description": "Alex.Immer iOS & Android app",
            "allowed_origins": [
                "app://alex.immer",
                "aleximmermobile://",
                "capacitor://localhost",
            ],
        },
    ]

    print("🔐 Generating Client Secrets for Music Service API")
    print("=" * 80)
    print()

    for client in clients:
        client_secret = generate_client_secret()
        secret_name = f"music-service/clients/{client['client_id']}"

        secret_value = {
            "client_id": client["client_id"],
            "client_secret": client_secret,
            "allowed_origins": client["allowed_origins"],
            "description": client["description"],
            "cookie_duration_hours": 2,
            "created_at": datetime.utcnow().isoformat() + "Z",
        }

        print(f"Client: {client['client_id']}")
        print(f"Description: {client['description']}")
        print(f"Secret Name: {secret_name}")
        print("Secret Value:")
        print(json.dumps(secret_value, indent=2))
        print()
        print("AWS CLI Command to update secret:")
        print(
            f"aws secretsmanager put-secret-value \\\n"
            f"  --secret-id {secret_name} \\\n"
            f"  --secret-string '{json.dumps(secret_value)}'"
        )
        print()
        print("-" * 80)
        print()

    print("✅ Client secrets generated successfully!")
    print()
    print("📋 Next steps:")
    print()
    print("1. Run terraform apply to create the secret resources")
    print("2. Use the AWS CLI commands above to update each secret")
    print("3. Verify secrets are stored correctly:")
    print(
        "   aws secretsmanager get-secret-value --secret-id music-service/clients/alexmbugua-personal"  # noqa: E501
    )
    print()
    print("⚠️  IMPORTANT: Keep these secrets secure!")
    print("   Do NOT commit them to version control.")
    print("   Store them in AWS Secrets Manager only.")
    print()


if __name__ == "__main__":
    main()
