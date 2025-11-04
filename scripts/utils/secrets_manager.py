"""AWS Secrets Manager Integration.

This module provides secure credential management via AWS Secrets Manager.
Credentials are fetched at runtime and cached in memory (never written to disk).

Security Features:
- No credentials stored in environment variables
- Automatic caching with TTL (5 minutes)
- Audit trail via CloudTrail
- Fine-grained IAM access control

Usage:
    from scripts.utils.secrets_manager import get_aws_credentials

    # Fetch credentials
    creds = get_aws_credentials()
    s3_client = boto3.client(
        's3',
        aws_access_key_id=creds['access_key_id'],
        aws_secret_access_key=creds['secret_access_key']
    )
"""

import json
import os
from datetime import datetime, timedelta
from typing import Any

import boto3
from botocore.exceptions import ClientError


class SecretsManagerClient:
    """Client for AWS Secrets Manager with caching."""

    def __init__(self, region_name: str = "us-east-1"):
        """Initialize Secrets Manager client.

        Args:
            region_name: AWS region where secrets are stored
        """
        self.region_name = region_name
        self._cache: dict[str, dict[str, Any]] = {}
        self._cache_ttl = timedelta(minutes=5)  # Cache secrets for 5 minutes

        # Initialize boto3 client
        # This will use:
        # 1. AWS_PROFILE environment variable (local dev)
        # 2. IAM role (Lambda/EC2)
        # 3. ~/.aws/credentials (local dev fallback)
        self._client = boto3.client("secretsmanager", region_name=self.region_name)

    def get_secret(self, secret_name: str, force_refresh: bool = False) -> dict[str, Any]:
        """Fetch a secret from AWS Secrets Manager.

        Args:
            secret_name: Name of the secret to fetch
            force_refresh: If True, bypass cache and fetch fresh secret

        Returns:
            Dictionary containing the secret value

        Raises:
            ClientError: If secret not found or access denied
            ValueError: If secret value is not valid JSON

        Example:
            >>> client = SecretsManagerClient()
            >>> secret = client.get_secret("music-service/aws-credentials")
            >>> print(secret['access_key_id'])
        """
        # Check cache first (unless force refresh)
        if not force_refresh and secret_name in self._cache:
            cached_entry = self._cache[secret_name]
            if datetime.now() < cached_entry["expires_at"]:
                cached_value: dict[str, Any] = cached_entry["value"]
                return cached_value

        # Fetch from Secrets Manager
        try:
            response = self._client.get_secret_value(SecretId=secret_name)
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            if error_code == "ResourceNotFoundException":
                raise ValueError(f"Secret not found: {secret_name}") from e
            elif error_code == "AccessDeniedException":
                raise PermissionError(
                    f"Access denied to secret: {secret_name}. "
                    "Ensure IAM role/user has secretsmanager:GetSecretValue permission."
                ) from e
            else:
                raise

        # Parse secret value
        secret_string = response.get("SecretString")
        if not secret_string:
            raise ValueError(f"Secret {secret_name} has no SecretString value")

        try:
            secret_value_raw = json.loads(secret_string)
        except json.JSONDecodeError as e:
            raise ValueError(f"Secret {secret_name} is not valid JSON") from e

        # Type assertion for mypy
        secret_value: dict[str, Any] = secret_value_raw

        # Cache the secret
        self._cache[secret_name] = {
            "value": secret_value,
            "expires_at": datetime.now() + self._cache_ttl,
        }

        return secret_value

    def invalidate_cache(self, secret_name: str | None = None) -> None:
        """Invalidate cached secrets.

        Args:
            secret_name: If provided, invalidate only this secret.
                        If None, invalidate all cached secrets.
        """
        if secret_name:
            self._cache.pop(secret_name, None)
        else:
            self._cache.clear()


# ============================================================================
# Convenience Functions
# ============================================================================

# Global client instance (singleton pattern)
_secrets_client: SecretsManagerClient | None = None


def _get_client() -> SecretsManagerClient:
    """Get or create the global Secrets Manager client."""
    global _secrets_client
    if _secrets_client is None:
        _secrets_client = SecretsManagerClient()
    return _secrets_client


def get_aws_credentials(force_refresh: bool = False) -> dict[str, str]:
    """Fetch AWS credentials for music-service IAM user.

    This is the recommended way to get AWS credentials for S3/CloudFront operations.

    Args:
        force_refresh: If True, bypass cache and fetch fresh credentials

    Returns:
        Dictionary with keys:
        - access_key_id: AWS access key ID
        - secret_access_key: AWS secret access key
        - created_at: Timestamp when credentials were created

    Raises:
        ValueError: If secret not found or invalid format
        PermissionError: If access denied to secret

    Example:
        >>> creds = get_aws_credentials()
        >>> s3 = boto3.client('s3',
        ...     aws_access_key_id=creds['access_key_id'],
        ...     aws_secret_access_key=creds['secret_access_key']
        ... )
    """
    client = _get_client()
    secret_name = os.getenv("SECRETS_MANAGER_SECRET_NAME", "music-service/aws-credentials")
    return client.get_secret(secret_name, force_refresh=force_refresh)


def get_cloudfront_private_key(force_refresh: bool = False) -> dict[str, str]:
    """Fetch CloudFront private key for signed URL generation.

    Used by Lambda functions for API Gateway to generate time-limited signed URLs.

    Args:
        force_refresh: If True, bypass cache and fetch fresh key

    Returns:
        Dictionary with keys:
        - private_key: RSA private key (PEM format)
        - key_pair_id: CloudFront key pair ID

    Example:
        >>> key_data = get_cloudfront_private_key()
        >>> signed_url = generate_signed_url(
        ...     url='https://cdn.example.com/song.mp3',
        ...     private_key=key_data['private_key'],
        ...     key_pair_id=key_data['key_pair_id']
        ... )
    """
    client = _get_client()
    secret_name = os.getenv("CLOUDFRONT_KEY_SECRET_NAME", "music-service/cloudfront-private-key")
    return client.get_secret(secret_name, force_refresh=force_refresh)


def get_secret(secret_name: str, force_refresh: bool = False) -> dict[str, Any]:
    """Generic function to fetch any secret from Secrets Manager.

    Args:
        secret_name: Name of the secret in Secrets Manager
        force_refresh: If True, bypass cache

    Returns:
        Dictionary containing the secret value

    Example:
        >>> db_creds = get_secret("music-service/database-credentials")
        >>> print(db_creds['username'])
    """
    client = _get_client()
    return client.get_secret(secret_name, force_refresh=force_refresh)


def invalidate_cache(secret_name: str | None = None) -> None:
    """Invalidate cached secrets.

    Call this after rotating credentials to force fresh fetch.

    Args:
        secret_name: If provided, invalidate only this secret.
                    If None, invalidate all cached secrets.

    Example:
        >>> # After rotating credentials
        >>> invalidate_cache("music-service/aws-credentials")
        >>> # Next call to get_aws_credentials() will fetch fresh credentials
    """
    client = _get_client()
    client.invalidate_cache(secret_name)
