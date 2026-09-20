# Exact crops of the user-provided ladder. No generated or substituted medals.
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$source = [System.Drawing.Bitmap]::FromFile((Join-Path $root 'public/assets/ranks/ladder-reference.png'))
function Export-Medal([string]$name, [int]$x, [int]$y, [int]$width, [int]$height) {
  $rect = [System.Drawing.Rectangle]::new($x, $y, $width, $height)
  $crop = $source.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $crop.Save((Join-Path $root "public/assets/ranks/$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $crop.Dispose()
}
Export-Medal 'unranked' 302 72 98 99
$tiers = @('kindled','oathbound','vanguard','bastion','dawnforged','luminary','sovereign')
$tops = @(207,351,495,639,785,931,1078)
$heights = @(81,82,83,87,88,89,91)
$divisions = @('mark','crest','standard','crown')
$lefts = @(288,428,576,731)
for ($r = 0; $r -lt $tiers.Count; $r++) {
  for ($c = 0; $c -lt 4; $c++) {
    Export-Medal "$($tiers[$r])-$($divisions[$c])" $lefts[$c] $tops[$r] 128 $heights[$r]
  }
}
Export-Medal 'dawnborn' 429 1232 222 128
$source.Dispose()
