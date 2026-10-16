S=$HOME/.local/share/dev.lwc.companion/state.json
c(){ sleep 2.5; python3 -c "import json;print('$1',json.load(open('$S')).get('total_keystrokes',0))"; }
xdotool type --delay 30 "hello world"; c "11 plain(expect 11)"
xdotool key Shift_L Escape F5 Up BackSpace a A; c "ignored(expect +0 except A? shift+a)"
xdotool keydown x; sleep 2; xdotool keyup x; c "held x 2s (expect +1)"
xdotool type --delay 30 "CANARYqz7XK zebra-violet-9931"; c "canary(29 minus a's)"
