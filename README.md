sm.hoist.VisualComponents
=========================

### Install

`package.json`
````
"scripts": {
    "build": "sm.hoist.visualcomponents sm.hoist.VisualComponents.json --build",
    "build-show": "sm.hoist.visualcomponents sm.hoist.VisualComponents.json --spin"
  },
  "dependencies": {
    "sm.hoist.visualcomponents": "0.1.x"
  }
}
````

`sm.hoist.VisualComponents.json`
````
{
    "config": {
	    "sm.hoist.visualcomponents/0": {
	    	"viewer": {
	    		"port": 8082
    		},
	    	"source": {
	    		"server": {
	    			"cwd": "{{__DIRNAME__}}",
	    			"runInterpreter": "node",
	    			"run": "{{__DIRNAME__}}/node_modules/.bin/gulp",
	    			"host": "localhost:8083",
	    			"wait": "2",
	    			"env": {
	    				"PORT": 8083
	    			}
	    		}
	    	},
	    	"components": {
	    		"Home": {
	    			"source": "/"
    			}
	    	},
	    	"target": {
	    		"path": "{{__DIRNAME__}}/.sm.hoisted"
	    	}
	    }
	}
}
````

### Run

````
npm run-script build
npm run-script build-how
````


### Troubleshoot

````
export DEBUG=1
export VERBOSE=1
pm2 logs
````
