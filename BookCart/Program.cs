using BookCart.Extensions;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddBookCartOptions()
    .AddBookCartPersistence()
    .AddBookCartAuth()
    .AddBookCartApi();

var app = builder.Build();
app.UseBookCart();
app.Run();

// Makes the entry point visible to WebApplicationFactory<Program> in BookCart.Tests.
public partial class Program { }
