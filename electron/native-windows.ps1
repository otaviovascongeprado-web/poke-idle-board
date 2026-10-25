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
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr child);
  [DllImport("kernel32.dll", EntryPoint="SetLastError")] private static extern void ResetLastError(uint value);
  public static bool ChangeOwner(IntPtr child, IntPtr owner) {
    ResetLastError(0);
    if (IntPtr.Size == 8) SetWindowLongPtr64(child, -8, owner); else SetWindowLong32(child, -8, owner.ToInt32());
    return Marshal.GetLastWin32Error() == 0 && GetParent(child) == owner;
  }
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW", SetLastError=true)] private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)] private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int index, IntPtr value);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW", SetLastError=true)] private static extern int GetWindowLong32(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongW", SetLastError=true)] private static extern int SetWindowLong32(IntPtr hWnd, int index, int value);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll", SetLastError=true)] private static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool RedrawWindow(IntPtr hWnd, IntPtr updateRect, IntPtr updateRegion, uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowTextLengthW(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr hWnd, System.Text.StringBuilder text, int maxCount);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", EntryPoint="SetWindowPos", SetLastError=true)] private static extern bool SetWindowPosEx(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll", SetLastError=true)] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", SetLastError=true)] private static extern bool AttachThreadInput(uint attach, uint attachTo, bool attachInput);
  [DllImport("user32.dll")] private static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern IntPtr GetFocus();
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern uint GetQueueStatus(uint flags);
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
  public static bool ConnectInput(IntPtr child, IntPtr owner) {
    uint childPid, ownerPid;
    uint childThread = GetWindowThreadProcessId(child, out childPid);
    uint ownerThread = GetWindowThreadProcessId(owner, out ownerPid);
    if (childThread == 0 || ownerThread == 0 || childThread == ownerThread) return true;
    if (!AttachThreadInput(childThread, ownerThread, true)) return false;
    attachedInputThreads[child] = new uint[] { childThread, ownerThread };
    // Do not force focus here; clicking a pane should choose between its app and the board.
    return true;
  }
  public static void DisconnectInput(IntPtr child) {
    uint[] connected;
    if (!attachedInputThreads.TryGetValue(child, out connected)) return;
    if (connected.Length >= 2) AttachThreadInput(connected[0], connected[1], false);
    attachedInputThreads.Remove(child);
  }
  public static long GetStyle(IntPtr hWnd) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, -16).ToInt64() : GetWindowLong32(hWnd, -16);
  }
  public static void SetStyle(IntPtr hWnd, long style) {
    if (IntPtr.Size == 8) SetWindowLongPtr64(hWnd, -16, new IntPtr(style)); else SetWindowLong32(hWnd, -16, unchecked((int)style));
  }
  public static void UsePerMonitorDpi() { SetThreadDpiAwarenessContext(new IntPtr(-4)); }
  public static void SetOwnedStyle(IntPtr hWnd, long originalStyle) {
    const long chrome = 0x00C00000L | 0x00040000L | 0x00080000L | 0x00020000L | 0x00010000L;
    long style = originalStyle & ~0x40000000L & ~chrome;
    style |= 0x80000000L | 0x10000000L | 0x02000000L | 0x04000000L;
    SetStyle(hWnd, style);
    SetWindowPosEx(hWnd, IntPtr.Zero, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020);
  }
  public static bool Place(IntPtr hWnd, int x, int y, int width, int height, bool visible) {
    const uint NOACTIVATE = 0x0010, NOOWNERZORDER = 0x0200, NOCOPYBITS = 0x0100;
    bool placed = SetWindowPosEx(hWnd, new IntPtr(-2), x, y, Math.Max(1, width), Math.Max(1, height), NOACTIVATE | NOOWNERZORDER | NOCOPYBITS);
    ShowWindow(hWnd, visible ? 4 : 0);
    if (placed && visible) RedrawWindow(hWnd, IntPtr.Zero, IntPtr.Zero, 0x0001 | 0x0080);
    return placed;
  }
  public static bool Place(IntPtr hWnd, IntPtr owner, int x, int y, int width, int height, bool visible) {
    var point = new POINT { X=x, Y=y };
    if (!ClientToScreen(owner, ref point)) return false;
    return Place(hWnd, point.X, point.Y, width, height, visible);
  }
  public static bool FocusChild(IntPtr child, IntPtr owner) {
    if (!IsWindow(child) || !IsWindow(owner)) return false;
    uint childPid, ownerPid;
    uint childThread = GetWindowThreadProcessId(child, out childPid);
    uint ownerThread = GetWindowThreadProcessId(owner, out ownerPid);
    uint helperThread = GetCurrentThreadId();
    GetQueueStatus(0x04FF);
    var attached = new List<uint>();
    try {
      if (childThread == 0) return false;
      if (childThread != helperThread) {
        if (!AttachThreadInput(helperThread, childThread, true)) return false;
        attached.Add(childThread);
      }
      SetForegroundWindow(child);
      SetFocus(child);
      return GetFocus() == child;
    } finally {
      for (int index = attached.Count - 1; index >= 0; index--) AttachThreadInput(helperThread, attached[index], false);
    }
  }
  public static bool EnsureEmbedded(IntPtr child, IntPtr parent, long originalStyle, int x, int y, int width, int height, bool visible) {
    if (!IsWindow(child) || !IsWindow(parent)) return false;
    long style = GetStyle(child);
    bool repaired = GetParent(child) != parent || (style & 0x40000000L) != 0 || (style & 0x80000000L) == 0;
    if (repaired) {
      SetOwnedStyle(child, originalStyle);
      if (GetParent(child) != parent && !ChangeOwner(child, parent)) return false;
    }
    var rect = new RECT();
    bool matches = GetWindowRect(child, out rect);
    if (matches) {
      var point = new POINT { X=x, Y=y };
      matches = ClientToScreen(parent, ref point)
        && rect.Left == point.X && rect.Top == point.Y
        && rect.Right - rect.Left == Math.Max(1, width) && rect.Bottom - rect.Top == Math.Max(1, height);
    }
    if (repaired || !matches) {
      bool placed = Place(child, parent, x, y, width, height, visible);
      if (placed && repaired && visible) FocusChild(child, parent);
      return placed;
    }
    if (IsWindowVisible(child) != visible) ShowWindow(child, visible ? 4 : 0);
    return true;
  }
}
'@ -ErrorAction Stop
  [SincronizeWindowApi]::UsePerMonitorDpi()
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
      'attach' {
        $child = [IntPtr]([Int64]$request.hwnd)
        $parent = [IntPtr]([Int64]$request.parent)
        $owner = [IntPtr]([Int64]$request.owner)
        if (-not [SincronizeWindowApi]::IsWindow($child)) { throw 'A janela selecionada já foi fechada.' }
        [SincronizeWindowApi]::SetOwnedStyle($child, [Int64]$request.style)
        if (-not [SincronizeWindowApi]::ChangeOwner($child, $owner)) { throw 'O Windows recusou o vínculo desta janela ao painel.' }
        $ok = [SincronizeWindowApi]::Place($child, $owner, [int]$request.x, [int]$request.y, [int]$request.width, [int]$request.height, [bool]$request.visible)
        if (-not $ok -or -not [SincronizeWindowApi]::ConnectInput($child, $owner)) {
          [SincronizeWindowApi]::DisconnectInput($child)
          [void][SincronizeWindowApi]::ChangeOwner($child, [IntPtr]([Int64]$request.originalParent))
          [SincronizeWindowApi]::SetStyle($child, [Int64]$request.style)
          throw 'O Windows não permitiu vincular esta janela ao painel.'
        }
        [void][SincronizeWindowApi]::FocusChild($child, $owner)
        $result = @{ ok=$ok }
      }
      'ensureEmbedded' {
        $child = [IntPtr]([Int64]$request.hwnd)
        $parent = [IntPtr]([Int64]$request.parent)
        $ok = [SincronizeWindowApi]::EnsureEmbedded($child, $parent, [Int64]$request.style, [int]$request.x, [int]$request.y, [int]$request.width, [int]$request.height, [bool]$request.visible)
        $result = @{ ok=$ok }
      }
      'position' {
        $child = [IntPtr]([Int64]$request.hwnd)
        $owner = [IntPtr]([Int64]$request.owner)
        $ok = [SincronizeWindowApi]::Place($child, $owner, [int]$request.x, [int]$request.y, [int]$request.width, [int]$request.height, [bool]$request.visible)
        $result = @{ ok=$ok }
      }
      'detach' {
        $child = [IntPtr]([Int64]$request.hwnd)
        [SincronizeWindowApi]::DisconnectInput($child)
        [void][SincronizeWindowApi]::ChangeOwner($child, [IntPtr]([Int64]$request.parent))
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
