# Shell Variables & Currency Protection

Normal prose with currency: A single coffee costs $5, while a full meal costs $10 or $15.50. Between $5 and $10 is the sweet spot.

Inline code with dollar signs: `$HADOOP_HOME/bin/hdfs` and `$PATH:$HOME/.local/bin` and `echo $USER`.

Fenced bash block that previously triggered 40s LaTeX regex timeouts:
```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-arm64
export HADOOP_HOME=/opt/hadoop
export PATH=$PATH:$HADOOP_HOME/bin:$HADOOP_HOME/sbin
echo "Total cost: $5 + $10 = $15"
awk '{print $1, $2, $NF}' /var/log/syslog
```

Actual math right after shell variables: $\Delta E = mc^2$ and another currency mention of $20.
