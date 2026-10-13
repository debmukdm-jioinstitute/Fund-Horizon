"""Operator CLI for initial administrative and staff provisioning.

Usage:
    python -m app.cli.bootstrap_admin --email admin@fundhorizon.internal --name "System Admin" --role admin

Supports interactive password entry via getpass (or --password / FH_ADMIN_BOOTSTRAP_PASSWORD env var).
No hardcoded passwords, no email dependencies.
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys

from app.api.auth import _hash_password
from app.db import get_repository, sqlite


def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap or promote staff members for Fund Horizon Backoffice")
    parser.add_argument("--email", required=True, help="Staff email address")
    parser.add_argument("--name", default="Staff Member", help="Staff full name")
    parser.add_argument("--mobile", default="9999999999", help="10-digit mobile number")
    parser.add_argument(
        "--role",
        choices=["admin", "analyst", "rm", "operations", "read_only"],
        default="admin",
        help="Staff role",
    )
    parser.add_argument("--password", help="Password (interactive prompt used if omitted)")
    parser.add_argument("--temp-password", action="store_true", help="Mark account to require password change")
    args = parser.parse_args()

    email = args.email.strip().lower()
    name = args.name.strip()
    role = args.role
    mobile = args.mobile.strip()

    password = args.password or os.environ.get("FH_ADMIN_BOOTSTRAP_PASSWORD")
    if not password:
        if sys.stdin.isatty():
            password = getpass.getpass(f"Enter password for {email}: ")
            confirm = getpass.getpass("Confirm password: ")
            if password != confirm:
                print("Error: Passwords do not match", file=sys.stderr)
                sys.exit(1)
        else:
            print("Error: Password must be supplied via --password or FH_ADMIN_BOOTSTRAP_PASSWORD in non-interactive shell", file=sys.stderr)
            sys.exit(1)

    if len(password) < 8:
        print("Error: Password must be at least 8 characters", file=sys.stderr)
        sys.exit(1)

    repo = get_repository()
    password_hash = _hash_password(password)

    # Check if user already exists
    existing = repo.get_customer_by_email(email)
    if existing:
        user_id = existing["id"]
        fields = {
            "name": name or existing.get("name"),
            "role": role,
            "is_staff": 1,
            "status": "active",
            "password_hash": password_hash,
            "must_change_password": 1 if args.temp_password else 0,
        }
        repo.update_customer(user_id, fields)
        print(f"Successfully updated staff user '{email}' to role '{role}' (is_staff=1)")
    else:
        # Create customer record
        created = repo.create_customer(
            name=name,
            email=email,
            mobile=mobile,
            password_hash=password_hash,
            role=role,
        )
        user_id = created["id"]
        repo.update_customer(
            user_id,
            {
                "is_staff": 1,
                "status": "active",
                "must_change_password": 1 if args.temp_password else 0,
            },
        )
        print(f"Successfully created staff user '{email}' with ID '{user_id}' and role '{role}'")


if __name__ == "__main__":
    main()
