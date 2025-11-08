#!/usr/bin/env python3
"""CloudFront utility functions for cache invalidation and distribution management."""

import time

import boto3
from botocore.exceptions import ClientError

from .config import Config


def get_cloudfront_client(region: str = "us-east-1"):
    """Get configured CloudFront client.

    CloudFront is a global service, but we specify us-east-1 as the region.

    Args:
        region: AWS region (CloudFront uses us-east-1)

    Returns:
        boto3 CloudFront client
    """
    return boto3.client("cloudfront", region_name=region)


def invalidate_cloudfront_cache(
    paths: list[str],
    distribution_id: str | None = None,
    wait: bool = False,
    dry_run: bool = False,
) -> str | None:
    """Invalidate CloudFront cache for specified paths.

    CloudFront invalidations help ensure users see updated content immediately
    instead of waiting for cached versions to expire.

    Args:
        paths: List of paths to invalidate (e.g., ['/metadata/*', '/covers/album.png'])
        distribution_id: CloudFront distribution ID (from config if not provided)
        wait: If True, wait for invalidation to complete
        dry_run: If True, only print what would be invalidated

    Returns:
        Invalidation ID if successful, None if dry-run or error

    Example:
        invalidate_cloudfront_cache(['/metadata/manifest.json', '/covers/*'])
    """
    config = Config()

    if not distribution_id:
        distribution_id = config.cloudfront_distribution_id

    if not distribution_id:
        print("⚠️  No CloudFront distribution ID configured")
        print("   Set CLOUDFRONT_DISTRIBUTION_ID in .env")
        return None

    if dry_run:
        print("🔄 [DRY-RUN] Would invalidate CloudFront cache:")
        print(f"   Distribution: {distribution_id}")
        print("   Paths:")
        for path in paths:
            print(f"     - {path}")
        return None

    client = get_cloudfront_client()

    # Create invalidation batch
    caller_reference = f"music-sync-{int(time.time())}"
    invalidation_batch = {
        "Paths": {"Quantity": len(paths), "Items": paths},
        "CallerReference": caller_reference,
    }

    try:
        print("🔄 Invalidating CloudFront cache...")
        print(f"   Distribution: {distribution_id}")
        print(f"   Paths: {len(paths)} path(s)")

        response = client.create_invalidation(
            DistributionId=distribution_id, InvalidationBatch=invalidation_batch
        )

        invalidation_id = response["Invalidation"]["Id"]
        status = response["Invalidation"]["Status"]

        print(f"✅ Invalidation created: {invalidation_id}")
        print(f"   Status: {status}")

        if wait:
            print("⏳ Waiting for invalidation to complete...")
            waiter = client.get_waiter("invalidation_completed")
            waiter.wait(
                DistributionId=distribution_id,
                Id=invalidation_id,
                WaiterConfig={"Delay": 20, "MaxAttempts": 60},  # Check every 20s for up to 20 min
            )
            print("✅ Invalidation completed!")
        else:
            print("💡 Invalidation in progress (typically takes 1-5 minutes)")
            print(
                f"   Track status: aws cloudfront get-invalidation --id {invalidation_id} --distribution-id {distribution_id}"  # noqa: E501
            )

        return str(invalidation_id)

    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        error_message = e.response.get("Error", {}).get("Message", str(e))

        if error_code == "TooManyInvalidationsInProgress":
            print("❌ Too many invalidations in progress")
            print("   CloudFront allows max 3 concurrent invalidations")
            print(
                "   Wait for existing invalidations to complete or use wildcards to combine paths"
            )
        elif error_code == "NoSuchDistribution":
            print(f"❌ Distribution not found: {distribution_id}")
            print("   Check CLOUDFRONT_DISTRIBUTION_ID in .env")
        else:
            print(f"❌ CloudFront invalidation failed: {error_code}")
            print(f"   {error_message}")

        return None


def invalidate_all_music_content(wait: bool = False, dry_run: bool = False) -> str | None:
    """Invalidate all music-related content in CloudFront.

    This invalidates all albums, covers, trackers, and metadata.
    Useful after a full publish to ensure all content is fresh.

    Args:
        wait: If True, wait for invalidation to complete
        dry_run: If True, only print what would be invalidated

    Returns:
        Invalidation ID if successful, None if dry-run or error
    """
    paths = [
        "/albums/*",
        "/covers/*",
        "/tracker/*",
        "/metadata/*",
    ]

    return invalidate_cloudfront_cache(paths, wait=wait, dry_run=dry_run)


def invalidate_metadata_only(wait: bool = False, dry_run: bool = False) -> str | None:
    """Invalidate only metadata files in CloudFront.

    Useful when only metadata has changed (e.g., updated manifests)
    without changing actual audio files or covers.

    Args:
        wait: If True, wait for invalidation to complete
        dry_run: If True, only print what would be invalidated

    Returns:
        Invalidation ID if successful, None if dry-run or error
    """
    paths = ["/metadata/*"]

    return invalidate_cloudfront_cache(paths, wait=wait, dry_run=dry_run)


def get_invalidation_status(
    invalidation_id: str, distribution_id: str | None = None
) -> dict | None:
    """Get status of a CloudFront invalidation.

    Args:
        invalidation_id: Invalidation ID to check
        distribution_id: CloudFront distribution ID (from config if not provided)

    Returns:
        Invalidation details dict or None if error
    """
    config = Config()

    if not distribution_id:
        distribution_id = config.cloudfront_distribution_id

    if not distribution_id:
        print("⚠️  No CloudFront distribution ID configured")
        return None

    client = get_cloudfront_client()

    try:
        response = client.get_invalidation(DistributionId=distribution_id, Id=invalidation_id)

        invalidation = response["Invalidation"]
        status = invalidation["Status"]
        create_time = invalidation["CreateTime"]
        paths = invalidation["InvalidationBatch"]["Paths"]["Items"]

        print("📊 Invalidation Status:")
        print(f"   ID: {invalidation_id}")
        print(f"   Status: {status}")
        print(f"   Created: {create_time}")
        print(f"   Paths: {len(paths)} path(s)")
        for path in paths:
            print(f"     - {path}")

        return dict(invalidation)

    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        error_message = e.response.get("Error", {}).get("Message", str(e))
        print(f"❌ Failed to get invalidation status: {error_code}")
        print(f"   {error_message}")
        return None


def list_recent_invalidations(distribution_id: str | None = None, max_items: int = 10) -> None:
    """List recent CloudFront invalidations.

    Args:
        distribution_id: CloudFront distribution ID (from config if not provided)
        max_items: Maximum number of invalidations to list
    """
    config = Config()

    if not distribution_id:
        distribution_id = config.cloudfront_distribution_id

    if not distribution_id:
        print("⚠️  No CloudFront distribution ID configured")
        return

    client = get_cloudfront_client()

    try:
        response = client.list_invalidations(
            DistributionId=distribution_id, MaxItems=str(max_items)
        )

        invalidations = response.get("InvalidationList", {}).get("Items", [])

        if not invalidations:
            print("📋 No recent invalidations found")
            return

        print(f"📋 Recent Invalidations ({len(invalidations)}):")
        print()

        for inv in invalidations:
            inv_id = inv["Id"]
            status = inv["Status"]
            create_time = inv["CreateTime"]

            status_icon = "✅" if status == "Completed" else "⏳"
            print(f"{status_icon} {inv_id}")
            print(f"   Status: {status}")
            print(f"   Created: {create_time}")
            print()

    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        error_message = e.response.get("Error", {}).get("Message", str(e))
        print(f"❌ Failed to list invalidations: {error_code}")
        print(f"   {error_message}")
