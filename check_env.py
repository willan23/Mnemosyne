
import os
import re

def get_env_vars(path):
    vals = {}
    try:
        with open(path, 'r') as f:
            for line in f:
                if '=' in line:
                    k, v = line.strip().split('=', 1)
                    vals[k] = v
    except Exception as e:
        print(f"Error reading {path}: {e}")
    return vals

frontend_env = get_env_vars(r'w:\SaaS\frontend\.env')
print("Frontend ENV:")
for k, v in frontend_env.items():
    if 'PRICE' in k:
        print(f"  {k} = {v}")

print("\nHardcoded in stripe.ts:")
# I'll just print what I expect to match for verification
print("  Checking for specific IDs...")
