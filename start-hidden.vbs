Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Administrator\Desktop\twodrapes-factory-tool"
WshShell.Run "cmd /c node server.js", 0, False
WScript.Sleep 5000
Set colPorts = GetObject("winmgmts:\\.\root\cimv2").ExecQuery("SELECT * FROM Win32_PerfFormattedData_Tcpip_TCPv4 WHERE LocalPort=8080")
If colPorts.Count > 0 Then
    WScript.Echo "PORT_8080_LISTENING"
Else
    WScript.Echo "PORT_8080_NOT_LISTENING"
End If
