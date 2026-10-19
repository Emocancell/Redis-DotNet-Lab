FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/RedisLab.Api/RedisLab.Api.csproj src/RedisLab.Api/
RUN dotnet restore src/RedisLab.Api/RedisLab.Api.csproj
COPY src/RedisLab.Api/ src/RedisLab.Api/
RUN dotnet publish src/RedisLab.Api/RedisLab.Api.csproj -c Release --no-restore -o /out
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet","RedisLab.Api.dll"]
