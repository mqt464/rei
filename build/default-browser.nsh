!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Rei" "" "Rei"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Rei\DefaultIcon" "" '"$appExe",0'
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Rei\shell\open\command" "" '"$appExe"'
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Rei\Capabilities" "ApplicationName" "Rei"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Rei\Capabilities" "ApplicationDescription" "Rei web browser"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Rei\Capabilities" "ApplicationIcon" '"$appExe",0'
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Rei\Capabilities\URLAssociations" "http" "ReiHTML"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Rei\Capabilities\URLAssociations" "https" "ReiHTML"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "Rei" "Software\Clients\StartMenuInternet\Rei\Capabilities"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ReiHTML" "" "Rei HTML Document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ReiHTML" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\ReiHTML\DefaultIcon" "" '"$appExe",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\ReiHTML\shell\open\command" "" '"$appExe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "Rei"
  DeleteRegKey SHELL_CONTEXT "Software\Clients\StartMenuInternet\Rei"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\ReiHTML"
!macroend
