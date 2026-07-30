[CmdletBinding()]
param(
    [string]$Destination,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$defaultDestination = 'C:\datasets\AMI'
$annotationUrl = 'https://groups.inf.ed.ac.uk/ami/AMICorpusAnnotations/ami_public_manual_1.6.2.zip'
$audioBaseUrl = 'https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus'

if ([string]::IsNullOrWhiteSpace($Destination)) {
    $response = Read-Host "AMI dataset destination [$defaultDestination]"
    $Destination = if ([string]::IsNullOrWhiteSpace($response)) { $defaultDestination } else { $response }
}

$Destination = [Environment]::ExpandEnvironmentVariables($Destination)
if (-not [IO.Path]::IsPathRooted($Destination)) {
    $Destination = Join-Path (Get-Location) $Destination
}
$Destination = [IO.Path]::GetFullPath($Destination)
$audioDirectory = Join-Path $Destination 'audio'
$annotationArchive = Join-Path $Destination 'ami_public_manual_1.6.2.zip'
$meetingsFile = Join-Path $Destination 'corpusResources\meetings.xml'
$curl = Get-Command 'curl.exe' -ErrorAction Stop

$recordings = @(
    @{ Meeting = 'ES2004a'; Speaker = 'A'; Channel = 0 },
    @{ Meeting = 'ES2004b'; Speaker = 'B'; Channel = 1 },
    @{ Meeting = 'ES2004c'; Speaker = 'C'; Channel = 2 },
    @{ Meeting = 'IS1009a'; Speaker = 'D'; Channel = 3 },
    @{ Meeting = 'IS1009b'; Speaker = 'A'; Channel = 0 },
    @{ Meeting = 'IS1009c'; Speaker = 'B'; Channel = 1 },
    @{ Meeting = 'TS3003a'; Speaker = 'C'; Channel = 2 },
    @{ Meeting = 'TS3003b'; Speaker = 'D'; Channel = 3 },
    @{ Meeting = 'TS3003c'; Speaker = 'A'; Channel = 0 },
    @{ Meeting = 'EN2002a'; Speaker = 'B'; Channel = 1 },
    @{ Meeting = 'EN2002b'; Speaker = 'C'; Channel = 2 },
    @{ Meeting = 'EN2002d'; Speaker = 'D'; Channel = 3 }
)

function Invoke-ResumableDownload {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$OutputPath
    )

    if ($Force) {
        Remove-Item -LiteralPath $OutputPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath "$OutputPath.part" -Force -ErrorAction SilentlyContinue
    }

    if (Test-Path -LiteralPath $OutputPath -PathType Leaf) {
        if ((Get-Item -LiteralPath $OutputPath).Length -gt 0) {
            Write-Host "Already downloaded: $OutputPath"
            return
        }
        Remove-Item -LiteralPath $OutputPath -Force
    }

    $partialPath = "$OutputPath.part"
    Write-Host "Downloading: $Uri"
    & $curl.Source -L --fail --retry 3 --retry-delay 2 --continue-at - --output $partialPath $Uri
    if ($LASTEXITCODE -ne 0) {
        throw "Download failed with exit code $LASTEXITCODE`: $Uri"
    }
    if (-not (Test-Path -LiteralPath $partialPath -PathType Leaf) -or (Get-Item -LiteralPath $partialPath).Length -eq 0) {
        throw "Download produced an empty file: $Uri"
    }
    Move-Item -LiteralPath $partialPath -Destination $OutputPath -Force
}

function Test-WavFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [IO.File]::OpenRead($Path)
    try {
        if ($stream.Length -lt 12) { return $false }
        $header = New-Object byte[] 12
        [void]$stream.Read($header, 0, $header.Length)
        $riff = [Text.Encoding]::ASCII.GetString($header, 0, 4)
        $wave = [Text.Encoding]::ASCII.GetString($header, 8, 4)
        return $riff -eq 'RIFF' -and $wave -eq 'WAVE'
    } finally {
        $stream.Dispose()
    }
}

New-Item -ItemType Directory -Force -Path $Destination, $audioDirectory | Out-Null

Write-Host "AMI Meeting Corpus destination: $Destination"
Write-Host 'Source and license: AMI Meeting Corpus, CC BY 4.0'

if ($Force -or -not (Test-Path -LiteralPath $meetingsFile -PathType Leaf)) {
    Invoke-ResumableDownload -Uri $annotationUrl -OutputPath $annotationArchive
    Write-Host 'Extracting AMI manual annotations...'
    Expand-Archive -LiteralPath $annotationArchive -DestinationPath $Destination -Force
} else {
    Write-Host "Annotations already extracted: $meetingsFile"
}

if (-not (Test-Path -LiteralPath $meetingsFile -PathType Leaf)) {
    throw "AMI annotation layout is invalid; missing $meetingsFile"
}

foreach ($recording in $recordings) {
    $meeting = $recording.Meeting
    $channel = $recording.Channel
    $fileName = "$meeting.Headset-$channel.wav"
    $url = "$audioBaseUrl/$meeting/audio/$fileName"
    $outputPath = Join-Path $audioDirectory $fileName
    Invoke-ResumableDownload -Uri $url -OutputPath $outputPath
    if (-not (Test-WavFile -Path $outputPath)) {
        throw "Downloaded file is not a RIFF/WAVE file: $outputPath"
    }

    $wordsFile = Join-Path $Destination "words\$meeting.$($recording.Speaker).words.xml"
    if (-not (Test-Path -LiteralPath $wordsFile -PathType Leaf)) {
        throw "Required AMI word annotation is missing: $wordsFile"
    }
}

Write-Host ''
Write-Host "AMI quick-profile download is complete: $Destination"
Write-Host "Downloaded recordings: $($recordings.Count)"
Write-Host ''
Write-Host 'Prepare the benchmark dataset with:'
$repoRoot = Split-Path -Parent $PSScriptRoot
Write-Host "npm --prefix `"$repoRoot\desktop`" run benchmark:prepare-ami -- --ami-root `"$Destination`" --profile quick --out stt/samples/ami-ihm-quick"
