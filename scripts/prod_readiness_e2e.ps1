$ErrorActionPreference = 'Stop'
$env:JWT_SECRET = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$env:JWT_REFRESH_SECRET = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
$env:MONGO_URI = 'mongodb://127.0.0.1:27017/monster_security_test'
$env:NODE_ENV = 'development'
$env:PORT = '5055'
$env:CLOUDINARY_CLOUD_NAME = ''
$env:CLOUDINARY_API_KEY = ''
$env:CLOUDINARY_API_SECRET = ''
$env:CLOUDINARY_DISABLED = '1'
$testEmail = "secure.owner.$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())@example.com"
$testLicenseNo = "DL-SEC-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"

$pngPath = Join-Path $PWD 'tmp-test.png'
$pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5WcMsAAAAASUVORK5CYII='
[System.IO.File]::WriteAllBytes($pngPath, [System.Convert]::FromBase64String($pngBase64))

$badPath = Join-Path $PWD 'tmp-bad.jpg'
[System.IO.File]::WriteAllBytes($badPath, [byte[]](0x4D,0x5A,0x90,0x00,0x03,0x00,0x00,0x00))

$outLog = Join-Path $PWD 'tmp-server-out.log'
$errLog = Join-Path $PWD 'tmp-server-err.log'
$server = Start-Process -FilePath node -ArgumentList 'server.js' -WorkingDirectory $PWD -PassThru -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
$passed = $false

try {
  Start-Sleep -Seconds 5

  $health = Invoke-RestMethod -Uri 'http://localhost:5055/health' -Method Get
  if (-not $health.success) { throw 'Health failed' }

  $signupJson = curl.exe -s -X POST http://localhost:5055/api/auth/signup `
    -F "medicalName=Secure Med" `
    -F "ownerName=Owner One" `
    -F "address=123 Main Street" `
    -F "email=$testEmail" `
    -F "contactNo=9999999999" `
    -F "drugLicenseNo=$testLicenseNo" `
    -F "password=SecurePass123!" `
    -F "drugLicenseImage=@$pngPath"
  $signupResp = $signupJson | ConvertFrom-Json
  if (-not $signupResp.success) { throw 'Signup failed' }

  $loginResp = Invoke-RestMethod -Uri 'http://localhost:5055/api/auth/login' -Method Post -ContentType 'application/json' -Body (@{email=$testEmail;password='SecurePass123!';role='medicalOwner'} | ConvertTo-Json)
  if (-not $loginResp.success -or -not $loginResp.accessToken -or -not $loginResp.refreshToken) { throw 'Login failed' }

  $invalidRejected = $false
  try {
    Invoke-RestMethod -Uri 'http://localhost:5055/api/auth/login' -Method Post -ContentType 'application/json' -Body (@{email=$testEmail;password='WrongPass!';role='medicalOwner'} | ConvertTo-Json) | Out-Null
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 401) { $invalidRejected = $true }
  }
  if (-not $invalidRejected) { throw 'Invalid credentials were not rejected' }

  $refreshResp = Invoke-RestMethod -Uri 'http://localhost:5055/api/auth/refresh' -Method Post -ContentType 'application/json' -Body (@{refreshToken=$loginResp.refreshToken} | ConvertTo-Json)
  if (-not $refreshResp.success -or -not $refreshResp.accessToken) { throw 'Refresh failed' }

  $invalidRefreshRejected = $false
  try {
    Invoke-RestMethod -Uri 'http://localhost:5055/api/auth/refresh' -Method Post -ContentType 'application/json' -Body (@{refreshToken='badtoken'} | ConvertTo-Json) | Out-Null
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -in @(400,401)) { $invalidRefreshRejected = $true }
  }
  if (-not $invalidRefreshRejected) { throw 'Invalid refresh token not rejected' }

  $meResp = Invoke-RestMethod -Uri 'http://localhost:5055/api/auth/me' -Method Get -Headers @{ Authorization = "Bearer $($loginResp.accessToken)" }
  if (-not $meResp.success) { throw '/me failed' }

  $expired = node -e "const jwt=require('jsonwebtoken'); console.log(jwt.sign({userId:'$($meResp.user._id)',email:'$testEmail',role:'user'}, process.env.JWT_SECRET, {expiresIn:-1}));"
  $expiredRejected = $false
  try {
    Invoke-RestMethod -Uri 'http://localhost:5055/api/auth/me' -Method Get -Headers @{ Authorization = "Bearer $expired" } | Out-Null
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 401) { $expiredRejected = $true }
  }
  if (-not $expiredRejected) { throw 'Expired token not rejected' }

  $unauthRejected = $false
  try {
    Invoke-RestMethod -Uri 'http://localhost:5055/api/company' -Method Get | Out-Null
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 401) { $unauthRejected = $true }
  }
  if (-not $unauthRejected) { throw 'Protected route accessible without auth' }

  $nonAdminDenied = $false
  try {
    Invoke-RestMethod -Uri 'http://localhost:5055/api/company' -Method Post -Headers @{ Authorization = "Bearer $($loginResp.accessToken)" } -ContentType 'application/json' -Body (@{name='NonAdminCreate'} | ConvertTo-Json) | Out-Null
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 403) { $nonAdminDenied = $true }
  }
  if (-not $nonAdminDenied) { throw 'Non-admin was not denied on admin route' }

$promoteScript = @"
const mongoose = require('mongoose');
const User = require('./models/User');
mongoose.connect(process.env.MONGO_URI).then(async () => {
  await User.updateOne({ email: '$testEmail' }, { role: 'admin' });
  await mongoose.disconnect();
});
"@
  node -e $promoteScript

  $adminLogin = Invoke-RestMethod -Uri 'http://localhost:5055/api/auth/login' -Method Post -ContentType 'application/json' -Body (@{email=$testEmail;password='SecurePass123!';role='medicalOwner'} | ConvertTo-Json)
  $companyName = "AdminCreateCo-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
  $adminCreate = Invoke-RestMethod -Uri 'http://localhost:5055/api/company' -Method Post -Headers @{ Authorization = "Bearer $($adminLogin.accessToken)" } -ContentType 'application/json' -Body (@{name=$companyName;description='ok'} | ConvertTo-Json)
  if (-not $adminCreate.success) { throw 'Admin create company failed' }

  $badUploadResult = curl.exe -s -o NUL -w "%{http_code}" -X POST http://localhost:5055/api/stockist/upload-license `
    -H "Authorization: Bearer $($adminLogin.accessToken)" `
    -F "licenseImage=@$badPath"
  if ($badUploadResult.Trim() -ne '400') { throw "Malicious file not rejected (status=$badUploadResult)" }

  $logoutResp = Invoke-RestMethod -Uri 'http://localhost:5055/api/auth/logout' -Method Post -Headers @{ Authorization = "Bearer $($adminLogin.accessToken)" }
  if (-not $logoutResp.success) { throw 'Logout failed' }

  $rateLimited = $false
  for ($i=0; $i -lt 15; $i++) {
    try {
      Invoke-RestMethod -Uri 'http://localhost:5055/api/auth/login' -Method Post -ContentType 'application/json' -Body (@{email=$testEmail;password='WrongAgain!';role='medicalOwner'} | ConvertTo-Json) | Out-Null
    } catch {
      if ($_.Exception.Response.StatusCode.value__ -eq 429) {
        $rateLimited = $true
        break
      }
    }
  }
  if (-not $rateLimited) { throw 'Rate limiting did not trigger on auth routes' }

  $passed = $true
  Write-Output 'E2E_TESTS_PASSED'
}
finally {
  if ($server -and !$server.HasExited) { Stop-Process -Id $server.Id -Force }
  Remove-Item -Path $pngPath,$badPath -ErrorAction SilentlyContinue
  if ($passed) {
    if (Test-Path $outLog) { Remove-Item $outLog -ErrorAction SilentlyContinue }
    if (Test-Path $errLog) { Remove-Item $errLog -ErrorAction SilentlyContinue }
  }
}
