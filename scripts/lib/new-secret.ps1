# Prints a random secret as lower-case hex (2 characters per byte). Works in Windows PowerShell 5.1 and PowerShell 7.
param([int]$Bytes = 32)
$buffer = New-Object byte[] $Bytes
$rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
$rng.GetBytes($buffer)
$rng.Dispose()
-join ($buffer | ForEach-Object { $_.ToString('x2') })
