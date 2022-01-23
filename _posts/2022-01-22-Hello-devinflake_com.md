---
title: "Hello devinflake.com"
date: 2022-01-22T00:00:00+00:00
author: Devin Flake
layout: post
permalink: /hello_devinflake_com/
tags: [ephesus, jekyll, helloworld]
---
I think I've finally found a simple blog solution that works for me.
[Jekyll](https://jekyllrb.com/) transforms plain text into static sites/blogs. I like that I can create posts from the CLI
and I'm hoping to use GitOps to push this blog to my k3s dramble cluster.

I'm using a minialist theme called [Ephesus](https://github.com/onepase/Ephesus) by Hakan Torun.
It's simple and easy to customise but also has great code syntax highlighting. Ex:

{% highlight c %}
#include <stdio.h>

//Function declarations
int is_prime(int n);
void goldbach(int g);

int main(){
	int number = 0;
	while(1){
		printf("Enter even number:");
		scanf("%d",&number);
		if(number>2 && number%2==0){
			goldbach(number);
		}
		else{
			printf("Incorrect number!");
		}
		printf("");
	}
	return 0;
}

{% endhighlight %}

## This is interesting

There's still **lots to learn** but this is a good start.  Thank you [Hakan Torun](https://hakan.io/) for the awesome Jekyll theme!
