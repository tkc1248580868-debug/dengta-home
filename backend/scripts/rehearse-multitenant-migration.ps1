[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PrivateBackupZip,
    [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"

$zipPath = (Resolve-Path -LiteralPath $PrivateBackupZip).Path
if ([System.IO.Path]::GetExtension($zipPath) -ne ".zip") {
    throw "PrivateBackupZip must be a ZIP archive."
}

if ([string]::IsNullOrWhiteSpace($ReportPath)) {
    $ReportPath = Join-Path $PSScriptRoot "multitenant-rehearsal-report.json"
}
$reportFullPath = [System.IO.Path]::GetFullPath($ReportPath)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$requiredTables = @(
    "settings",
    "memories",
    "conversations",
    "messages",
    "moments",
    "moment_comments",
    "companion_diary_entries"
)
$counts = [ordered]@{}
$columns = [ordered]@{}
$relationships = [ordered]@{}

try {
    $entries = @{}
    foreach ($entry in $archive.Entries) {
        $entries[$entry.FullName] = $entry
    }

    foreach ($table in $requiredTables) {
        $entryName = "$table.json"
        if (-not $entries.ContainsKey($entryName)) {
            throw "Backup is incomplete. Missing $entryName."
        }
        $reader = [System.IO.StreamReader]::new($entries[$entryName].Open())
        try {
            $rows = @($reader.ReadToEnd() | ConvertFrom-Json)
        }
        finally {
            $reader.Dispose()
        }
        $counts[$table] = $rows.Count
        $columns[$table] = @(
            if ($rows.Count -gt 0) {
                $rows[0].PSObject.Properties.Name
            }
        )

        switch ($table) {
            "messages" {
                $relationships["messages_without_conversation"] = @(
                    $rows | Where-Object { -not $_.conversation_id }
                ).Count
            }
            "moment_comments" {
                $relationships["comments_without_moment"] = @(
                    $rows | Where-Object { -not $_.moment_id }
                ).Count
            }
            "memories" {
                $relationships["conversation_scoped_memories"] = @(
                    $rows | Where-Object { $_.conversation_id }
                ).Count
            }
        }
    }
}
finally {
    $archive.Dispose()
}

if ($relationships["messages_without_conversation"] -ne 0) {
    throw "Rehearsal failed: a message has no conversation."
}
if ($relationships["comments_without_moment"] -ne 0) {
    throw "Rehearsal failed: a moment comment has no moment."
}

$migrationRoot = Split-Path -Parent $PSScriptRoot
$stageMigration = Join-Path $migrationRoot "supabase\012_multitenant_foundation.sql"
$finalMigration = Join-Path $migrationRoot "supabase\013_multitenant_finalize.sql"
foreach ($migration in @($stageMigration, $finalMigration)) {
    if (-not (Test-Path -LiteralPath $migration -PathType Leaf)) {
        throw "Required migration was not found: $migration"
    }
}

$report = [ordered]@{
    created_at = (Get-Date).ToUniversalTime().ToString("o")
    backup_file = [System.IO.Path]::GetFileName($zipPath)
    backup_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash
    source_counts = $counts
    source_columns = $columns
    relationship_checks = $relationships
    expected_owner_companions = 1
    expected_owner_companion_name = "小灯"
    expected_unassigned_rows_after_backfill = 0
    production_database_modified = $false
    rehearsal_kind = "archive-contract-and-ownership-dry-run"
    next_gate = "restore into an isolated Supabase project before production"
}

$json = $report | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText(
    $reportFullPath,
    $json,
    [System.Text.UTF8Encoding]::new($false)
)

Write-Host "Multi-tenant migration dry-run passed."
Write-Host "Report:"
Write-Host $reportFullPath
Write-Host "Production database modified: false"
