var fs = require('fs');
var util = require('util');
var path = require('path');
var yaml = require('js-yaml');
var MarkdownDeep = require('markdowndeep');
var readImageSize = require('image-size');
var debug = require('debug')('pageServer');
var debugRedirect = require('debug')('pageServer.redirect');
var highlight = require('highlight.js');
var got = require('got');
var request = require('request');

/////////////////////////////////////////////////////////////////////////////////////////////////
// parsePage(Sync|Async) - read a .page file and parse the yaml/json off the top (async version)
// 
// These functions parse a page file but don't handle imports or .common.page merging

// Helper to parse a page file and 
async function parsePageAsync(filename) 
{
	// Read the file
	var data = await util.promisify(fs.readFile)(filename, 'utf8');
	return parsePage(filename, data);
}

// Helper to parse a page file and strip the yaml/json off the top (sync version)
function parsePageSync(filename)
{
	var data = fs.readFileSync(filename, 'utf8');
	return parsePage(filename, data);
}

// Helper to parse page data and strip the yaml/json off the top
function parsePage(filename, data)
{
	// Setup the page object
	var page = {
		filename: filename,
	};

	// Count lead chars
	var leadchars = 1;
	while (leadchars < data.length && data[leadchars]==data[0]) 
	{
		leadchars++;
	}

	// Delimiter found?
	if (leadchars>=3) 
	{
		// Yes.

		var json = false;			
		var delim = data.substring(0, leadchars);
		if (delim[0]=='{')
		{
			delim = Array(delim.length).join('}');
			json = true;
		}
		var enddelim = data.indexOf(delim, leadchars);

		if (enddelim >= 0) 
		{
			var metadataText = data.substring(leadchars, enddelim);

			page.rawBody = data.substring(enddelim + leadchars).trim();

			var metadata;
			try	
			{
				if (json)
				{
					var strJson = "({\n" + metadataText + "\n})";
					metadata = eval(strJson);
				}
				else
				{
					 metadata = yaml.load(metadataText);
				}
			}
			catch (err)	
			{
				throw new Error("Error parsing page header of file "+ filename +" (" + (json ? "json" : "yaml") + "): " + err.toString());
			}

			for (key in metadata) 
			{
				page[key] = metadata[key];
			}
		}
		else
		{
			throw new Error("Misformed attribute delimiters");
		}
	}
	else
	{
		page.rawBody = data;
	}

	// Split off the summary before "***"
	if (page.rawBody)
	{
		var rx = /^\*\*\*$/m;

		var match = page.rawBody.match(rx);
		if (match)
		{
			page.summary = page.rawBody.substring(0, match.index);
		}
		else
		{
			page.summary = page.rawBody;
		}
	}
	else
	{
		page.summary="";
	}

	return page;
};



/////////////////////////////////////////////////////////////////////////////////////////////////
// readPageFile(Sync/Async) - read a .page file and merge imports and .common.page

// Load a page file and merge with imported base pages (async version)
async function readPageFileAsync(options, filename)
{
	// Read and parse the file
	var page = await parsePageAsync(filename);

	var imports = []

	// Try to automatically include .common.page
	if (!filename.endsWith(".common.page"))
	{
		try
		{
			var stats = await util.promisify(fs.lstat)(path.join(path.dirname(filename), ".common.page"));
			if (stats.isFile())
				imports.push(".common.page");
		}
		catch (x)
		{
			// doesn't exist
		}
	}

	// Append page imports
	if (page.import)
	{
		if (Array.isArray(page.import))
		{
			imports = imports.concat(page.import);
		}
		else
		{
			imports.push(page.import);
		}
		delete page.import;
	}

	// Quit early if no imports
	if (imports.length == 0)
		return page;

	// Merge with base page?
	var mergedPage;
	for (var i=0; i<imports.length; i++)
	{
		var importName = imports[i];

		var importFile;
		if (importName[0]=='/')
		{
			importFile = path.join(options.contentPath, importName.substr(1));
		}
		else
		{
			importFile = path.join(path.dirname(filename), importName);
		}

		var importedPage = await readPageFileAsync(options, importFile);

		// Merge pages
		if (i == 0)
			mergedPage = importedPage;
		else
			merge(mergedPage, importedPage);
	}

	// Move the top level page
	merge(mergedPage, page);

	return mergedPage;
}

// Load a page file and merge with imported base pages (sync version)
function readPageFileSync(options, filename)
{
	// Read and parse the file
	var page = parsePageSync(filename);

	var imports = []

	// Try to automatically include .common.page
	if (!filename.endsWith(".common.page"))
	{
		try
		{
			var stats = fs.lstatSync(path.join(path.dirname(filename), ".common.page"));
			if (stats.isFile())
				imports.push(".common.page");
		}
		catch (x)
		{
			// doesn't exist
		}
	}

	// Append page imports
	if (page.import)
	{
		if (Array.isArray(page.import))
		{
			imports = imports.concat(page.import);
		}
		else
		{
			imports.push(page.import);
		}
		delete page.import;
	}

	// Quit early if no imports
	if (imports.length == 0)
		return page;

	// Merge with base page?
	var mergedPage;
	for (var i=0; i<imports.length; i++)
	{
		var importName = imports[i];

		var importFile;
		if (importName[0]=='/')
		{
			importFile = path.join(options.contentPath, importName.substr(1));
		}
		else
		{
			importFile = path.join(path.dirname(filename), importName);
		}

		var importedPage = readPageFileSync(options, importFile);

		// Merge pages
		if (i == 0)
			mergedPage = importedPage;
		else
			merge(mergedPage, importedPage);
	}

	// Move the top level page
	merge(mergedPage, page);

	return mergedPage;
}

/////////////////////////////////////////////////////////////////////////////////////////////////
// mapUrlToFile(Sync/Async) - given a URL, work out the page file that serves it

async function mapUrlToFileAsync(options, url)
{
	// Is it a directory or file?
	var stats;
	try
	{
		stats = await util.promisify(fs.lstat)(path.join(options.contentPath, url));
	}
	catch (x)
	{
	}

	return mapUrlToFile(options, url, stats && stats.isDirectory());
}

function mapUrlToFileSync(options, url)
{
	// Is it a directory or file?
	var stats;
	try
	{
		stats = fs.lstatSync(path.join(options.contentPath, url));
	}
	catch (x)
	{
	}

	return mapUrlToFile(options, url, stats && stats.isDirectory());
}

function mapUrlToFile(options, url, isDirectory)
{
	var file = url;

	if (isDirectory)
	{
		if (!url.endsWith('/'))
		{
			url += '/';
			file += '/';
		}
		file += "index.page";
	}
	else
	{
		// Otherwise look for a page file
		file += ".page";
	}

	return [file, url];
}


/////////////////////////////////////////////////////////////////////////////////////////////////
// loadPageByUrl(Sync/Async) - map url to file, load the file and setup references and adornments

async function loadPageByUrlAsync(options, cache, url)
{
	// Work out the file name
	var filename;
	[filename, url] = await mapUrlToFileAsync(options, url);

	// Already loaded?
	if (cache[url])
		return cache[url];

	// Read the page file
	var page = await readPageFileAsync(options, path.join(options.contentPath, filename));

	// Cache it
	cache[url] = page;

	// Add adornments
	return adornPageObject(page, options, url, filename);
}

function loadPageByUrlSync(options, cache, url)
{
	// Work out the file name
	var filename;
	[filename, url] = mapUrlToFileSync(options, url);

	// Already loaded?
	if (cache[url])
		return cache[url];

	// Read the page file
	var page = readPageFileSync(options, path.join(options.contentPath, filename));

	// Cache it
	cache[url] = page;

	// Add adornments
	return adornPageObject(page, options, url, filename);
}

function adornPageObject(page, options, url, filename)
{
	// Store the file and url loaded from
	page.url = url;
	page.file = filename;

	// Provide the default view as "page"
	if (page.view === undefined)
		page.view = "page"

	// Delayed html rendering
	Object.defineProperty(page, 'body', {
		get: function() {

			// Remove this property
			delete this.body;

			if (!this.rawBody)
			{
				this.body = "";
			}
			else
			{
				// Tranform markdown
				g_markdownData = {
					rootpath: options.contentPath,
					fullpath: path.join(options.contentPath, filename),
					url: url,
					defaultSyntax: page.defaultSyntax,
				};
				this.body = mdd.Transform(page.rawBody);
				g_markdownData = null;
			}

			return this.body;
		},
		enumerable: true,
		configurable: true,
	});

	// Helper functions
	page.qualifyUrl = page_qualifyUrl;

	// Helper properties
	Object.defineProperty(page, "nextPage", {
		get: function() {
			return page_findNextPage(this, 1);
		},
		enumerable: true,
		configurable: true,
	});
	Object.defineProperty(page, "previousPage", {
		get: function() {
			return page_findNextPage(this, -1);
		},
		enumerable: true,
		configurable: true,
	});

	// Resolve references
	page.$refList = [];
	page.$refCache = {};
	if (page.references)
	{
		resolveReferences(options, page, page.references, page)
	}

	// Return the page
	return page;
}

function page_qualifyUrl(url)
{
	return resolveRelativeUrl(this.url, url);
}

function page_findNextPage(page, direction)
{
	// Get the sequence, quit if none
	var seq = page.sequence;
	if (!seq)
		return null;

	// Find index to self, quit if not found
	var index = seq.findIndex((elem) => elem.url == page.url);
	if (index < 0)
		return null;

	// Move, quit if out of range
	index += direction;
	if (index < 0 || index >= seq.length)
		return null;

	// return the page
	return seq[index];
}


/////////////////////////////////////////////////////////////////////////////////////////////////
// Referenced Page Handling

function updateRefList(page, value)
{
	// String - just add it as referenced page
	if (typeof(value) === "string")
	{
		page.$refList.push(value);
		return;
	}

	// Recursively add elements
	if (Array.isArray(value))
	{
		for (var i=0; i<value.length; i++)
			updateRefList(page, value[i]);
		return;
	}

	// Recursiively add elements
	if (isObject(value))
	{
		for (var k of Object.keys(value))
		{
			updateRefList(page, value[k]);
		}
	}
}

function buildReferences(options, page, value)
{
	// String - just add it as referenced page
	if (typeof(value) === "string")
	{
		return loadPageByUrlSync(options, page.$refCache, resolveRelativeUrl(page.url,  value));
	}

	if (Array.isArray(value))
	{
		var retVal = [];
		for (var j=0; j<value.length; j++)
		{
			retVal.push(buildReferences(options, page, value[j]));
		}
		return retVal;
	}

	// Recursiively add elements
	if (isObject(value))
	{
		var retVal = {};
		for (var k of Object.keys(value))
		{
			retVal[k] = buildReferences(options, page, value[k]);
		}
		return retVal;
	}

	return value;
}

function resolveReferences(options, page, references, target)
{
	var keys = Object.keys(references);
	for (var i=0; i<keys.length; i++)
	{
		var key = keys[i];

		// Page reference?
		if (typeof(references[key]) === "string")
		{
			(function(){
				var pageUrl = references[key];

				// Put it in the list of referenced page URLS
				updateRefList(page, pageUrl);

				Object.defineProperty(target, key, {
					get: function()
					{
						return buildReferences(options, page, pageUrl);
					},
					enumerable: true,
					configurable: true,
				});
			})();

			continue;
		}

		// Array of page references?
		if (Array.isArray(references[key]))
		{
			(function() {
				var elems = references[key];
				var prop = key;

				// Put it in the list of referenced page URLS
				updateRefList(page, elems);

				Object.defineProperty(target, key, {
					get: function()
					{
						return buildReferences(options, page, elems);
					},
					enumerable: true,
					configurable: true,
				});
			})();
			
		
			continue;
		}

		// Nested object map, recurse...
		if (isObject(references[key]))
		{
			if (target[key] === undefined)
				target[key] = {};
			resolveReferences(options, page, references[key], target[key]);
		}
	}
}

async function cacheImmediateReferences(options, page)
{
	// Any references?
	if (!page.$refList)
		return;

	// Cache them
	for (var i=0; i<page.$refList.length; i++)
	{
		await loadPageByUrlAsync(options, page.$refCache, resolveRelativeUrl(page.url, page.$refList[i]));
	}
}

async function loadRootPage(options, url)
{
	// Load the page
	var cache = {};
	var page = await loadPageByUrlAsync(options, cache, url);

	// Load external body?
	if (page.externalBody && !page.$externalBodyFeteched)
	{
		var extBody = (await got(page.externalBody, { cache: false })).body;

		if (!page.rawBody)
			page.rawBody = extBody;
		else
			page.rawBody += "\n\n" + extBody;

		page.$externalBodyFeteched = true;
	}

	page.$refCache = cache;
	await cacheImmediateReferences(options, page);
	return page;
}


/////////////////////////////////////////////////////////////////////////////////////////////////
// Page Server


function pageServer(options, req, res, next)
{
	// Only interested in get methods
	if (req.method.toLowerCase() != 'get')
	{
		next();
		return;
	}

	// Clean up multiple slashes in path
	var cleanupSlashes = req.url.replace(/\/\/+/gi, "/");
	if (cleanupSlashes != req.url)
	{
		return res.redirect(cleanupSlashes)
	}

	Promise.resolve(async function(){

		try
		{
			// Load the page
			var page = await loadRootPage(options, req.url);

			if (page.redirect)
				res.redirect(page.redirect);
			else
				res.render(page.view, page);
		}
		catch (err)
		{
			// Convert missing page errors to 404s
			if (err.code == "ENOENT")
			{	
				err = new Error('Page Not Found');
				err.status = 404;
			}
			throw err;
		}
	
	}()).catch(next);
};



/*
 * Provides simple url redirect and rewrite facilities
 *
 * Expects an array of rule objects where each rule contains:
 * 
 * Either "redirect" or "rewrite" property which is a regex
 * A "to" property which is the new url.
 *
 * eg:
 * [
 *    { redirect: /^\/rss.xml$/i, to: "/blog/feed" },
 * ]
 * 
 * A blank "to" string invokes a 404 and can be used to hide files.
 * 
 * [
 *    { rewrite: /^\/config\.js.*$/i, to: "" },
 *    { rewrite: /^\/views/i, to: "" },
 * ]
 */

function urlRulesFilter(rules, req, res, next)
{
	if (!rules)
	{
		next();
		return;
	}

	for (var i=0; i<rules.length; i++)
	{
		var rule = rules[i];

		var rx = rule.redirect ? rule.redirect : rule.rewrite;

		// If the rule contains "://" also include the protocol and hostname is the test string
		if (rule.redirect && rx.toString().indexOf(":\\/\\/")>=0)
		{
			testUrl = req.protocol + "://" + req.headers.host + req.url;
		}
		else
		{
			testUrl = req.url;
		}

		var newUrl = testUrl.replace(rx, rule.to);
		debugRedirect("matching", testUrl, "vs", rx, "gives", newUrl);
		if (newUrl!==testUrl)
		{
			if (newUrl=="")
			{
				var err = new Error('Not Found');
				err.status = 404;
				next(err);
				return;
			}
			else
			{
				if (rule.redirect)
				{
					res.redirect(newUrl);
					return;
				}
				else if (rule.proxy)
				{
					request(newUrl).pipe(res);
					return;
				}

				req.url = newUrl;
				break;
			}
		}
	}
	next();
}

/////////////////////////////////////////////////////////////////////////////////////////////////
// Markdown Support

// Used to store info required to resolve file location for image size resolution
var g_markdownData;

// Shared markdown transformer
var mdd = new MarkdownDeep.Markdown();
mdd.ExtraMode = true;
mdd.SafeMode = false;
mdd.MarkdownInHtml = false;
mdd.AutoHeadingIDs = true;
mdd.UserBreaks = true;
mdd.HtmlClassTitledImages = "figure";
mdd.DontEncodeCodeBlocks = true;
mdd.OnGetImageSize= function onGetImageSize(src) 
{
	// Fully qualified, can't do it
	if (src.indexOf('://')>=0)
		return undefined;

	// relative url?
	if (src.substring(0, 1)!='/')
	{
		var location = g_markdownData.fullpath;
		if (location.substr(-1)!='/')
			location = path.dirname(location);
		src = path.join(location, src);
	}
	else
	{
		src = path.join(g_markdownData.rootpath, src);
	}

	// Get the image size
	return getImageSizeHelper(src);
};


function HtmlEncode(str) 
{
	if (str === null || str === undefined)
		return "";
	return (""+str).replace(/["'&<>]/g, function(x) {
	    switch (x) 
	    {
	      case '\"': return '&quot;';
	      case '&': return '&amp;';
	      case '\'':return '&#39;';
	      case '<': return '&lt;';
	      case '>': return'&gt;';
	    }
	});
}

mdd.FormatCodeBlock = function onFormatCodeBlock(code, data, language)
{
	var language = language ? language : g_markdownData.defaultSyntax;

	if (!language)
	{
		return HtmlEncode(code);
	}

	switch (language)
	{
		case "c#":
		case "C#":
			language = "cs";
			break;

		case "c++":
			language = "cpp";
			break;
	}

	var result = highlight.highlight(language, code, true);
	return result.value;
}


/////////////////////////////////////////////////////////////////////////////////////////////////
// Image Size Helpers

var g_imageSizeCache = {}

// Help to get (and cache) the size of an image
function getImageSizeHelper(filename) {

	// Look up cache
	if (g_imageSizeCache)
	{
		if (filename in g_imageSizeCache)
		{
			return g_imageSizeCache[filename].imageSize;
		}
	}

	// Read image size
	var imageSize;
	try
	{
		imageSize = readImageSize(filename);

		// Adjust for retina images
		if (filename.substr(-7).toLowerCase()=="@2x.png")
		{
			imageSize.width /= 2;
			imageSize.height /= 2;
		}
	}
	catch (e)
	{
	}

	// Cache it
	if (g_imageSizeCache)
	{
		g_imageSizeCache[filename] = {
			imageSize: imageSize,
		};
	}

	return imageSize;
}

//////////////////////////////////////////////////////////////////////////////////
// Utils

function isObject(a)
{
	return a != null && typeof(a) === "object" && !Array.isArray(a);
}

function merge(a, b)
{
	if (a && b) 
	{
		for (var key in b) 
		{
			a[key] = b[key];
		}
	}
	return a;
}

function resolveRelativeUrl(base, url)
{
	// Simple rooted path case
	if (url.startsWith('/'))
		return url;

	// Remove file name
	if (!base.endsWith('/'))
		base = path.dirname(base);

	// Handle relative path navigation
	while (true)
	{
		if (url.startsWith("../"))
		{			
            base = path.dirname(base);
            if (!base.endsWith('/'))
                base += '/';
			url = url.substr(3);
			continue;
		}

		if (url.startsWith("./"))
		{			
			url = url.substr(2);
			continue;
		}

		if (url == "..")
		{
			base = path.dirname(base);
            if (!base.endsWith('/'))
                base += '/';
			url = "";
			continue;
		}

		if (url == ".")
		{
			url = "";
			continue;
		}

		break;
	}

	// Make sure not too many slashes
	if (base.endsWith('/'))
		base = base.substr(0, base.length - 1);

	// Join	
	return base + "/" + url;
}


//////////////////////////////////////////////////////////////////////////////////
// Exports

module.exports = 
{
	serve: function(options)
	{
		// Resolve whether to cache or not
		if (options.cache === undefined)
			options.cache = process.env.NODE_ENV == 'production';
		if (options.cache)
			options.$cache = {};

		debug(options.cache ? "Cache Enabled" : "Cache Disabled");

		var middleware =  function(req, res, next)
		{
			pageServer(options, req, res, next);
		}

		middleware.loadPageAsync = async function(url)
		{
			return await loadRootPage(options, url);
		}

		return middleware;
	},

	urlRules: function(rules)
	{
		return function(req, res, next)
		{
			urlRulesFilter(rules, req, res, next);
		}
	},

};