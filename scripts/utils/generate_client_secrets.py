#!/usr/bin/env python3
"""Generate Client Secrets for Music Service API

This script generates cryptographically secure random secrets for client authentication.
Use these secrets to populate AWS Systems Manager Parameter Store after running terraform apply.

Migration Note: Migrated from Secrets Manager to Parameter Store for cost optimization.

Usage:
    python scripts/utils/generate_client_secrets.py

Output:
    Displays client ID and generated secret for each client.
    Copy these values to AWS Parameter Store.
"""

import json
import secrets
from datetime import UTC, datetime


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
                "http://localhost:4321",
                "http://localhost:4322",
                "http://localhost:3000",
                "http://localhost:8080",
                "http://localhost:8888",
                "http://127.0.0.1:4321",
                "http://127.0.0.1:4322",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:8080",
                "http://127.0.0.1:8888",
                "https://alexmbugua.netlify.app",
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
                "http://localhost:3000",
                "http://localhost:8080",
                "http://localhost:8888",
                "http://127.0.0.1:4321",
                "http://127.0.0.1:4322",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:8080",
                "http://127.0.0.1:8888",
                "https://alexmbugua.netlify.app",
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
        parameter_name = f"/music-service/clients/{client['client_id']}"

        secret_value = {
            "client_id": client["client_id"],
            "client_secret": client_secret,
            "allowed_origins": client["allowed_origins"],
            "description": client["description"],
            "cookie_duration_hours": 2,
            "created_at": datetime.now(UTC).isoformat(),
        }

        print(f"Client: {client['client_id']}")
        print(f"Description: {client['description']}")
        print(f"Parameter Name: {parameter_name}")
        print("Parameter Value:")
        print(json.dumps(secret_value, indent=2))
        print()
        print("AWS CLI Command to update parameter:")
        print(
            f"aws ssm put-parameter \\\n"
            f"  --name {parameter_name} \\\n"
            f"  --type SecureString \\\n"
            f"  --value '{json.dumps(secret_value)}' \\\n"
            f"  --overwrite"
        )
        print()
        print("-" * 80)
        print()

    print("✅ Client secrets generated successfully!")
    print()
    print("📋 Next steps:")
    print()
    print("1. Run terraform apply to create the parameter resources")
    print("2. Use the AWS CLI commands above to update each parameter")
    print("3. Verify parameters are stored correctly:")
    print(
        "   aws ssm get-parameter --name /music-service/clients/alexmbugua-personal --with-decryption"  # noqa: E501
    )
    print()
    print("⚠️  IMPORTANT: Keep these secrets secure!")
    print("   Do NOT commit them to version control.")
    print("   Store them in AWS Parameter Store only.")
    print()
    print("💡 NOTE: Using Parameter Store instead of Secrets Manager saves $1.20/month")
    print("   Parameter Store is free for standard parameters with KMS encryption.")
    print()


if __name__ == "__main__":
    main()
