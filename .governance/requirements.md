# Isolated governance acceptance requirement

## Goal

Exercise the shipped project's record-completeness command on an explicitly authorized non-production branch, then observe whether required GitHub Actions checks prevent a noncompliant commit from reaching that branch.

## Acceptance

- The current CLI accepts complete work records and rejects a missing project name with its actual exit code.
- A required provider check rejects a failing commit on the protected experiment branch.
- After restoring the valid record, the provider check succeeds and the protected branch remains protected.

## Non-goals

This experiment does not prove semantic review quality, weighted approval, policy-self-change protection, all migrated mechanisms, or Project lifecycle behavior. Main and all production repositories remain unchanged.
