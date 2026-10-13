Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

If fso.FolderExists(fso.BuildPath(currentDir, "poke-idle-board\node_modules\electron")) Then
  appDir = fso.BuildPath(currentDir, "poke-idle-board")
Else
  appDir = currentDir
End If

electronExe = fso.BuildPath(appDir, "node_modules\electron\dist\electron.exe")

If fso.FileExists(electronExe) Then
  WshShell.CurrentDirectory = appDir
  WshShell.Run """" & electronExe & """ """ & appDir & """", 0, False
Else
  WshShell.Run "cmd /c """ & fso.BuildPath(appDir, "Abrir Board.bat") & """", 1, True
End If
