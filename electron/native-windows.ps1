$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class SincronizeWindowApi {
  private static readonly Dictionary<IntPtr, uint[]> attachedInputThreads = new Dictionary<IntPtr, uint[]>();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll", EntryPoint="CreateWindowExW", CharSet=CharSet.Unicode, SetLastError=true)] private static extern IntPtr CreateWindowEx(uint exStyle, string className, string windowName, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
  [DllImport("kernel32.dll", EntryPoint="GetModuleHandleW", CharSet=CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string moduleName);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool DestroyWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr child);
  [DllImport("kernel32.dll", EntryPoint="SetLastError")] private static extern void ResetLastError(uint value);
  public static bool ChangeParent(IntPtr child, IntPtr parent) {
    ResetLastError(0);
    SetParent(child, parent);
    return Marshal.GetLastWin32Error() == 0 && GetParent(child) == parent;
  }
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW", SetLastError=true)] private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)] private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int index, IntPtr value);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW", SetLastError=true)] private static extern int GetWindowLong32(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongW", SetLastError=true)] private static extern int SetWindowLong32(IntPtr hWnd, int index, int value);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool RedrawWindow(IntPtr hWnd, IntPtr updateRect, IntPtr updateRegion, uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowTextLengthW(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr hWnd, System.Text.StringBuilder text, int maxCount);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", EntryPoint="SetWindowPos", SetLastError=true)] private static extern bool SetWindowPosEx(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", SetLastError=true)] private static extern bool AttachThreadInput(uint attach, uint attachTo, bool attachInput);
  [DllImport("user32.dll")] private static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  public static long[] GetVisibleWindowHandles() {
    var handles = new List<long>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      if (IsWindowVisible(hWnd) && GetWindowTextLengthW(hWnd) > 0) handles.Add(hWnd.ToInt64());
      return true;
    }, IntPtr.Zero);
    return handles.ToArray();
  }
  public static string GetTitle(IntPtr hWnd) {
    int length = GetWindowTextLengthW(hWnd);
    if (length <= 0) return String.Empty;
    var text = new System.Text.StringBuilder(length + 1);
    GetWindowTextW(hWnd, text, text.Capacity);
    return text.ToString();
  }
  public static uint GetProcessId(IntPtr hWnd) { uint pid; GetWindowThreadProcessId(hWnd, out pid); return pid; }
  public static bool ConnectInput(IntPtr child, IntPtr host, IntPtr owner) {
    uint childPid, hostPid, ownerPid;
    uint childThread = GetWindowThreadProcessId(child, out childPid);
    uint[] candidates = new uint[] { GetWindowThreadProcessId(host, out hostPid), GetWindowThreadProcessId(owner, out ownerPid), GetCurrentThreadId() };
    var connected = new List<uint>();
    foreach (uint thread in candidates) {
      if (thread == 0 || thread == childThread || connected.Contains(thread)) continue;
      if (!AttachThreadInput(childThread, thread, true)) {
        foreach (uint previous in connected) AttachThreadInput(childThread, previous, false);
        return false;
      }
      connected.Add(thread);
    }
    connected.Insert(0, childThread);
    attachedInputThreads[child] = connected.ToArray();
    SetFocus(child);
    return true;
  }
  public static void DisconnectInput(IntPtr child) {
    uint[] connected;
    if (!attachedInputThreads.TryGetValue(child, out connected)) return;
    uint childThread = connected[0];
    for (int index = 1; index < connected.Length; index++) AttachThreadInput(childThread, connected[index], false);
    attachedInputThreads.Remove(child);
  }
  public static long GetStyle(IntPtr hWnd) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, -16).ToInt64() : GetWindowLong32(hWnd, -16);
  }
  public static void SetStyle(IntPtr hWnd, long style) {
    if (IntPtr.Size == 8) SetWindowLongPtr64(hWnd, -16, new IntPtr(style)); else SetWindowLong32(hWnd, -16, unchecked((int)style));
  }
  public static void SetChildStyle(IntPtr hWnd, long originalStyle) {
    const long chrome = 0x00C00000L | 0x00040000L | 0x00080000L | 0x00020000L | 0x00010000L;
    long style = originalStyle & ~0x80000000L & ~chrome;
    style |= 0x40000000L | 0x10000000L | 0x02000000L | 0x04000000L;
    SetStyle(hWnd, style);
  }
  public static IntPtr CreateHost(IntPtr parent, int x, int y, int width, int height, bool visible) {
    const uint CHILD=0x40000000, CLIPCHILDREN=0x02000000, CLIPSIBLINGS=0x04000000, VISIBLE=0x10000000, BLACKRECT=0x00000004;
    uint style = CHILD | CLIPCHILDREN | CLIPSIBLINGS | BLACKRECT | (visible ? VISIBLE : 0);
    IntPtr host = CreateWindowEx(0, "STATIC", "", style, x, y, Math.Max(1,width), Math.Max(1,height), parent, IntPtr.Zero, GetModuleHandle(null), IntPtr.Zero);
    if (host == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "O Windows não conseguiu criar o contêiner do painel.");
    return host;
  }
  public static bool Place(IntPtr hWnd, int x, int y, int width, int height, bool visible) {
    const uint NOACTIVATE = 0x0010, NOOWNERZORDER = 0x0200;
    bool placed = SetWindowPosEx(hWnd, IntPtr.Zero, x, y, Math.Max(1, width), Math.Max(1, height), NOACTIVATE | NOOWNERZORDER | 0x0020);
    ShowWindow(hWnd, visible ? 4 : 0);
    if (visible) RedrawWindow(hWnd, IntPtr.Zero, IntPtr.Zero, 0x0001 | 0x0080 | 0x0100);
    return placed;
  }
}
'@ -ErrorAction Stop
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $request = $line | ConvertFrom-Json
    $result = $null
    switch ($request.op) {
      'find' {
        $process = Get-Process -Id ([int]$request.pid) -ErrorAction Stop
        $process.Refresh()
        $hwnd = $process.MainWindowHandle
        $rect = New-Object SincronizeWindowApi+RECT
        $bounds = $null
        if ($hwnd -ne [IntPtr]::Zero -and [SincronizeWindowApi]::GetWindowRect($hwnd, [ref]$rect)) {
          $bounds = @{ x=$rect.Left; y=$rect.Top; width=($rect.Right-$rect.Left); height=($rect.Bottom-$rect.Top) }
        }
        $result = @{ hwnd=$hwnd.ToInt64(); bounds=$bounds }
      }
      'list' {
        $windows = New-Object 'System.Collections.Generic.List[object]'
        if ($null -eq $processes -or ((Get-Date) - $processCacheAt).TotalSeconds -gt 2) {
          $processes = @{}
          try {
            foreach ($process in Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,ExecutablePath -ErrorAction Stop) {
              $processes[[int]$process.ProcessId] = @{ parentPid=[int]$process.ParentProcessId; path=[string]$process.ExecutablePath }
            }
          } catch { }
          $processCacheAt = Get-Date
        }
        foreach ($value in [SincronizeWindowApi]::GetVisibleWindowHandles()) {
          $hwnd = [IntPtr]$value
          $rect = New-Object SincronizeWindowApi+RECT
          $bounds = $null
          if ([SincronizeWindowApi]::GetWindowRect($hwnd, [ref]$rect)) {
            $bounds = @{ x=$rect.Left; y=$rect.Top; width=($rect.Right-$rect.Left); height=($rect.Bottom-$rect.Top) }
          }
          $windowPid = [int][SincronizeWindowApi]::GetProcessId($hwnd)
          $proc = $processes[$windowPid]
          $name = if ($proc.path) { [IO.Path]::GetFileNameWithoutExtension($proc.path) } else { '' }
          $ancestors = New-Object 'System.Collections.Generic.List[int]'
          $cursor = $proc
          for ($depth = 0; $depth -lt 16 -and $null -ne $cursor; $depth++) {
            $parent = [int]$cursor.parentPid
            if ($parent -le 0) { break }
            [void]$ancestors.Add($parent)
            $cursor = $processes[$parent]
          }
          [void]$windows.Add(@{ hwnd=[string]$value; pid=$windowPid; parentPid=[int]$proc.parentPid; ancestors=$ancestors.ToArray(); processName=$name; executable=$proc.path; title=[SincronizeWindowApi]::GetTitle($hwnd); bounds=$bounds; style=[SincronizeWindowApi]::GetStyle($hwnd); parent=[SincronizeWindowApi]::GetParent($hwnd).ToInt64() })
        }
        $result = $windows.ToArray()
      }
      'processTree' {
        if ($null -eq $processes -or ((Get-Date) - $processCacheAt).TotalSeconds -gt 2) {
          $processes = @{}
          try {
            foreach ($process in Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,ExecutablePath -ErrorAction Stop) {
              $processes[[int]$process.ProcessId] = @{ parentPid=[int]$process.ParentProcessId; path=[string]$process.ExecutablePath }
            }
          } catch { }
          $processCacheAt = Get-Date
        }
        $rootPid = [int]$request.pid
        $seen = New-Object 'System.Collections.Generic.HashSet[int]'
        $frontier = New-Object 'System.Collections.Generic.HashSet[int]'
        [void]$seen.Add($rootPid)
        [void]$frontier.Add($rootPid)
        for ($depth = 0; $depth -lt 32 -and $frontier.Count -gt 0; $depth++) {
          $next = New-Object 'System.Collections.Generic.HashSet[int]'
          foreach ($processId in $processes.Keys) {
            $pidValue = [int]$processId
            $parentPid = [int]$processes[$pidValue].parentPid
            if ($frontier.Contains($parentPid) -and $seen.Add($pidValue)) { [void]$next.Add($pidValue) }
          }
          $frontier = $next
        }
        $result = @($seen | ForEach-Object { [int]$_ })
      }
      'isWindow' { $result = [SincronizeWindowApi]::IsWindow([IntPtr]([Int64]$request.hwnd)) }
      'disconnectInput' { [SincronizeWindowApi]::DisconnectInput([IntPtr]([Int64]$request.hwnd)); $result = $true }
      'closeWindow' { $result = [SincronizeWindowApi]::PostMessage([IntPtr]([Int64]$request.hwnd), 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
      'createHost' {
        $parent = [IntPtr]([Int64]$request.parent)
        if (-not [SincronizeWindowApi]::IsWindow($parent)) { throw 'A janela principal não está disponível para criar o contêiner do painel.' }
        $hostHwnd = [SincronizeWindowApi]::CreateHost($parent, [int]$request.x, [int]$request.y, [int]$request.width, [int]$request.height, [bool]$request.visible)
        $result = @{ hwnd=[string]$hostHwnd.ToInt64() }
      }
      'positionHost' {
        $hostHwnd = [IntPtr]([Int64]$request.hwnd)
        $ok = [SincronizeWindowApi]::Place($hostHwnd, [int]$request.x, [int]$request.y, [int]$request.width, [int]$request.height, [bool]$request.visible)
        $result = @{ ok=$ok }
      }
      'destroyHost' {
        $hostHwnd = [IntPtr]([Int64]$request.hwnd)
        $result = [SincronizeWindowApi]::DestroyWindow($hostHwnd)
      }
      'attach' {
        $child = [IntPtr]([Int64]$request.hwnd)
        $parent = [IntPtr]([Int64]$request.parent)
        $owner = [IntPtr]([Int64]$request.owner)
        if (-not [SincronizeWindowApi]::IsWindow($child)) { throw 'A janela selecionada já foi fechada.' }
        [SincronizeWindowApi]::SetChildStyle($child, [Int64]$request.style)
        if (-not [SincronizeWindowApi]::ChangeParent($child, $parent)) { throw 'O Windows recusou o encaixe desta janela. Aplicativos elevados ou com renderização exclusiva podem não permitir incorporação.' }
        if (-not [SincronizeWindowApi]::ConnectInput($child, $parent, $owner)) {
          [void][SincronizeWindowApi]::ChangeParent($child, [IntPtr]([Int64]$request.originalParent))
          [SincronizeWindowApi]::SetStyle($child, [Int64]$request.style)
          throw 'O Windows não permitiu encaminhar teclado e mouse para este aplicativo.'
        }
        $ok = [SincronizeWindowApi]::Place($child, [int]$request.x, [int]$request.y, [int]$request.width, [int]$request.height, [bool]$request.visible)
        $result = @{ ok=$ok }
      }
      'position' {
        $child = [IntPtr]([Int64]$request.hwnd)
        $ok = [SincronizeWindowApi]::Place($child, [int]$request.x, [int]$request.y, [int]$request.width, [int]$request.height, [bool]$request.visible)
        $result = @{ ok=$ok }
      }
      'detach' {
        $child = [IntPtr]([Int64]$request.hwnd)
        [SincronizeWindowApi]::DisconnectInput($child)
        [void][SincronizeWindowApi]::ChangeParent($child, [IntPtr]([Int64]$request.parent))
        [SincronizeWindowApi]::SetStyle($child, [Int64]$request.style)
        $ok = [SincronizeWindowApi]::Place($child, [int]$request.x, [int]$request.y, [int]$request.width, [int]$request.height, $true)
        $result = @{ ok=$ok }
      }
      default { throw 'Operação de janela desconhecida.' }
    }
    $response = @{ id=$request.id; result=$result } | ConvertTo-Json -Compress -Depth 5
    [Console]::Out.WriteLine($response)
  } catch {
    $response = @{ id=$request.id; error=$_.Exception.Message } | ConvertTo-Json -Compress -Depth 5
    [Console]::Out.WriteLine($response)
  }
}
