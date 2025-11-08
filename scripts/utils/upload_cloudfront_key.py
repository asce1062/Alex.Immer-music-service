#!/usr/bin/env python3
"""Upload CloudFront Private Key to AWS Secrets Manager

This script uploads the CloudFront private key to AWS Secrets Manager.

Usage:
    python scripts/upload_cloudfront_key.py --key-file keys/cloudfront_private_key.pem --key-pair-id K2JCJMDEHXQW5F

Requirements:
    - AWS credentials configured (via ~/.aws/credentials or environment variables)
    - boto3 installed (pip install boto3)
"""  # noqa: E501

import argparse
import json
import sys
from pathlib import Path

try:
    import boto3
    from botocore.exceptions import ClientError
except ImportError:
    print("❌ Error: boto3 is not installed")
    print("Install it with: pip install boto3")
    sys.exit(1)


def upload_signing_key(key_file: Path, key_pair_id: str, region: str = "us-east-1"):
    """Upload CloudFront signing key to Secrets Manager."""
    # Read private key file
    if not key_file.exists():
        print(f"❌ Error: Private key file not found: {key_file}")
        sys.exit(1)

    with Path.open(key_file) as f:
        private_key = f.read()

    # Prepare secret value
    secret_value = {"private_key": private_key, "key_pair_id": key_pair_id}

    signing_key_secret_name = "music-service/cloudfront-signing-key"  # noqa: S105  # nosec B105

    # Upload to Secrets Manager
    client = boto3.client("secretsmanager", region_name=region)

    try:
        print(f"🔐 Uploading CloudFront signing key to {signing_key_secret_name}...")
        response = client.put_secret_value(
            SecretId=signing_key_secret_name, SecretString=json.dumps(secret_value)
        )

        print("✅ CloudFront signing key uploaded successfully!")
        print(f"   Secret ARN: {response['ARN']}")
        print(f"   Version ID: {response['VersionId']}")
        print()
        print("📋 Next steps:")
        print(
            "1. Copy the public key to Terraform directory: cp keys/cloudfront_public_key.pem infrastructure/terraform/remote-state/02-infrastructure/"  # noqa: E501
        )
        print(
            "2. Run: cd infrastructure/terraform/remote-state/02-infrastructure && terraform apply"
        )
        print()

    except ClientError as e:
        if e.response["Error"]["Code"] == "ResourceNotFoundException":
            print(f"❌ Error: Secret {signing_key_secret_name} does not exist.")
            print("   Run terraform apply first to create the secret resource.")
        else:
            print(f"❌ Error uploading secret: {e}")
        sys.exit(1)


def main():
    """Main function."""
    parser = argparse.ArgumentParser(
        description="Upload CloudFront private key to AWS Secrets Manager"
    )
    parser.add_argument(
        "--key-file",
        type=Path,
        default=Path("keys/cloudfront_private_key.pem"),
        help="Path to CloudFront private key file (default: keys/cloudfront_private_key.pem)",
    )
    parser.add_argument(
        "--key-pair-id",
        required=True,
        help="CloudFront Key Pair ID (e.g., K2JCJMDEHXQW5F)",
    )
    parser.add_argument("--region", default="us-east-1", help="AWS region (default: us-east-1)")

    args = parser.parse_args()

    upload_signing_key(args.key_file, args.key_pair_id, args.region)


if __name__ == "__main__":
    main()
