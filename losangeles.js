/////////////////////////////////////////////////////////////////////////////////////////////////
// losangeles.js - simple markdown page server

var fs = require('fs');
var util = require('util');
var path = require('path');
var yaml = require('js-yaml');
var MarkdownDeep = require('markdowndeep');
var readImageSize = require('image-size');
var debug = require('debug')('losangeles');
var debugUrlRules = require('debug')('losangeles.urlRules');
var got = require('got');
var request = require('request');
var lru = require('lru-cache');

/////////////////////////////////////////////////////////////////////////////////////////////////
// Page loading

// This function parses a page file but don't handle imports or .common.page merging
async function parsePageFileAsync(filename) 
{
	// Read the file
	var data = await util.promisify(fs.readFile)(filename, 'utf8');

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

	return page;
};



// Load a page file and merge with imported base pages
async function loadPageFileAsync(options, filename)
{
	debug(`Loading file ${filename}...`);

	// Read and parse the file
	var page = await parsePageFileAsync(filename);

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

		var importedPage = await loadPageFileAsync(options, importFile);

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


async function mapUrlToFileAsync(options, url)
{
	// Is it a directory or file?
	var stats;
	try
	{
		stats = await util.promisify(fs.stat)(path.join(options.contentPath, url));
	}
	catch (x)
	{
	}

	var isDirectory = stats && stats.isDirectory();

	var file = url;

	if (isDirectory)
	{
		if (!url.endsWith('/'))
		{
			url += '/';
			file += '/';
		}
		file += "index";
	}

	if (await util.promisify(fs.exists)(path.join(options.contentPath, file + ".md")))
	{
		file += ".md";
	}
	else
	{
		file += ".page";
	}

	return [file, url];
}

async function loadPageAsync(options, url)
{
	// Cached?
	if (options.$cache)
	{
		var page = options.$cache.get(url);
		if (page)
		{
			debug(`Page '${page.url}' found in cache.`);
			return page;
		}
	}

	// Work out the file name
	var filename;
	[filename, url] = await mapUrlToFileAsync(options, url);

	// Read the page file
	var page = await loadPageFileAsync(options, path.join(options.contentPath, filename));

	// Store the file and url loaded from
	page.url = url;
	page.filename = filename;

	// Provide the default view as "page"
	if (page.view === undefined)
		page.view = "page"

	if (page.isMarkdown === false)
	{
		page.body = page.rawBody;
	}
	else
	{
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
						remapLanguages: page.remapLanguages,
						noHighlight: options.noHighlight === undefined ? false : options.noHighlight,
					};
					this.body = mdd.Transform(page.rawBody);
					g_markdownData = null;
				}

				return this.body;
			},
			enumerable: true,
			configurable: true,
		});
	}

	// Helper functions
	page.options = options;
	page.qualifyUrl = page_qualifyUrl;
	page.loadPageAsync = page_loadPageAsync;
	page.getImageSize = page_getImageSize;

	// Load external body?
	if (page.externalBody)
	{
		var extBody = (await got(page.externalBody, { cache: false })).body;

		if (!page.rawBody)
			page.rawBody = extBody;
		else
			page.rawBody += "\n\n" + extBody;
	}

	// Return the page
	if (options.$cache)
	{
		options.$cache.set(page.url, page);
		debug(`Cached page '${page.url}'.`);
	}

	return page;
}

function page_qualifyUrl(url)
{
	return resolveRelativeUrl(this.url, url);
}

async function page_loadPageAsync(url)
{
	return await loadPageAsync(this.options, resolveRelativeUrl(this.url, url));
}

function page_getImageSize(url)
{
	var filename = path.join(this.options.contentPath, resolveRelativeUrl(this.url, url));
	return getImageSize(filename);
}

/////////////////////////////////////////////////////////////////////////////////////////////////
// Page Server

function pageServerMiddleware(options, req, res, next)
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
			var page = await loadPageAsync(options, req.url);

			page.originalUrl = req.protocol + '://' + req.get('host') + req.originalUrl;

			if (page.redirect)
				res.redirect(page.redirect);
			else
				res.render(page.view, page);
		}
		catch (err)
		{
			// Convert missing page errors to 404s
			if (err.code != "ENOENT")
				throw err;
			next();
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

		var rx = rule.redirect || rule.rewrite || rule.proxy;

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
		debugUrlRules("matching", testUrl, "vs", rx, "gives", newUrl);
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
	return getImageSize(src);
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

mdd.FormatCodeBlockAttributes = function onFormatCodeBlockAttributes(opts)
{
	var language = opts.language || g_markdownData.defaultSyntax || "txt";

	if (g_markdownData.remapLanguages && g_markdownData.remapLanguages[language])
	{
		language = g_markdownData.remapLanguages[language];
	}

	return " class=\"language-" + language + "\"";
}

mdd.FormatCodeBlock = function onFormatCodeBlock(code, data, language)
{
	return HtmlEncode(code);
}


/////////////////////////////////////////////////////////////////////////////////////////////////
// Image Size Helpers

var g_imageSizeCache = {};

// Clear the image size cache
function clearImageSizeCache()
{
	g_imageSizeCache = {};
}

// Helper to get (and cache) the size of an image
function getImageSize(filename) {

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
		if (filename.substr(-7,3).toLowerCase()=="@2x")
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
	parsePageFileAsync: parsePageFileAsync,
	loadPageFileAsync: loadPageFileAsync,
	mapUrlToFileAsync: mapUrlToFileAsync,
	loadPageAsync: loadPageAsync,
	resolveRelativeUrl: resolveRelativeUrl,
	clearImageSizeCache: clearImageSizeCache,
	getImageSize: getImageSize,
	
	serve: function(options)
	{
		// Resolve whether to cache or not
		if (options.cache === undefined)
			options.cache = process.env.NODE_ENV == 'production';
		if (options.cache)
		{
			if (!options.cacheMaxPages)
				options.cacheMaxPages = 50;
			options.$cache = new lru(options.cacheMaxPages);
		}

		debug(options.cache ? `Cache Enabled (max ${options.cacheMaxPages} pages)` : "Cache Disabled");

		return {
			middleware: function(req, res, next)
			{
				pageServerMiddleware(options, req, res, next);
			},
			loadPageAsync: async function(url)
			{
				return await loadPageAsync(options, url);
			},
			clearCache: function()
			{
				if (options.$cache)
					options.$cache.reset();
				clearImageSizeCache();
				debug("Cache cleared.")
			}
		}
	},

	urlRules: function(rules)
	{
		return function(req, res, next)
		{
			urlRulesFilter(rules, req, res, next);
		}
	},

};