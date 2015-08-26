

Load CSS/JS dynamically using minimal code
==========================================

````
	var el = document.createElement("link");
    el.setAttribute("rel", "stylesheet");
    el.setAttribute("type", "text/css");
    el.setAttribute("media", "all");
    el.setAttribute("href", '{{skinUrl}}');
    document.getElementsByTagName("head")[0].appendChild(el);

	function loadScript(url, callback) {
	    var script = document.createElement("script")
	    script.type = "text/javascript";
	    if (script.readyState) {  //IE
	        script.onreadystatechange = function() {
	            if (
	            	script.readyState == "loaded" ||
                    script.readyState == "complete"
                ) {
	                script.onreadystatechange = null;
	                callback();
	            }
	        };
	    } else {  // Others
	        script.onload = function(){
	            callback();
	        };
	    }
	    script.src = url;
	    document.getElementsByTagName("head")[0].appendChild(script);
	}
````


Virtual DOM Test
================

````
var h = require('virtual-dom/h');
var diff = require('virtual-dom/diff');
var patch = require('virtual-dom/patch');
var createElement = require('virtual-dom/create-element');

var Delegator = require('dom-delegator')


var $ = require('jquery');

// 1: Create a function that declares what the DOM should look like
function render(count)  {
    return h('div', {
      "ev-click": function (ev) {
//    delegator.unlistenTo('click')
    console.log(ev)
console.log("CLICK!! 1");
          },
        style: {
            top: '100px',
            border: '1px solid red',
          position: 'relative',
            width: (100 + count) + 'px',
            height: (100 + count) + 'px'
        }
    }, [h('div', {
      id: 'boxid',
      style: {
        position: 'relative',
            top: (5 + count) + 'px',
            left: (5 + count) + 'px',
            border: '1px solid black',
            width: (60 + count) + 'px',
            height: (60 + count) + 'px'
       }
    })]);
}


function render2(count)  {
    return h('div', {
          "ev-click": function (ev) {
//    delegator.unlistenTo('click')
    console.log(ev)
console.log("CLICK!! 2");
          },
        style: {
            textAlign: 'center',
            lineHeight: (40 + count) + 'px', 
          position: 'relative',
            border: '1px solid blue',
            x: (5 + count) + 'px',
            width: (40 + count) + 'px',
            height: (40 + count) + 'px'
        }
    }, [String(count)]);
}

// 2: Initialise the document
var count = 0;      // We need some app data. Here we just store a count.

var tree = render(count);               // We need an initial tree
var rootNode = createElement(tree);     // Create an initial root DOM node ...
document.body.appendChild(rootNode);    // ... and it should be in the document

console.log($('#boxid'));

var tree2 = render2(count);               // We need an initial tree
var rootNode2 = createElement(tree2);     // Create an initial root DOM node ...

$('#boxid').get(0).appendChild(rootNode2);


var delegator = Delegator()
delegator.listenTo('click')

//document.body.appendChild(rootNode2);    // ... and it should be in the document

var up = true;
// 3: Wire up the update logic
setInterval(function () {
  
  if (up) {
      count++;
  } else {
      count--;
  }
  
  if (count > 100) up = false;
  if (count < 10) up = true;
  
      var newTree = render(count);
      var patches = diff(tree, newTree);
      rootNode = patch(rootNode, patches);
      tree = newTree;

      var newTree2 = render2(count);
      var patches2 = diff(tree2, newTree2);
      rootNode2 = patch(rootNode2, patches2);
      tree2 = newTree2;
  
}, 50);
````

