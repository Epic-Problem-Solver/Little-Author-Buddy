S=$HOME/.local/share/dev.lwc.companion/state.json
c(){ sleep 2.5; python3 -c "import json,sys;print(sys.argv[1],json.load(open('$S')).get('total_keystrokes',0))" "$1"; }
xdotool type --delay 30 "AAAA"; c "AAAA->0"
xdotool type --delay 30 "aaaa"; c "aaaa->0"
xdotool type --delay 30 "CANARY"; c "CANARY->+3"
xdotool type --delay 30 "-"; c "dash->+1"
xdotool type --delay 30 "9931"; c "9931->+4"
xdotool type --delay 30 "q z7XK"; c "->+6"
