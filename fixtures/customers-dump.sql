-- MySQL dump 10.13  Distrib 8.0.35, for Linux (x86_64)
--
-- Host: db-prod.internal    Database: crm
-- ------------------------------------------------------
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;

DROP TABLE IF EXISTS `customers`;
CREATE TABLE `customers` (
  `customer_id` int NOT NULL AUTO_INCREMENT,
  `first_name` varchar(40) DEFAULT NULL,
  `last_name` varchar(40) DEFAULT NULL,
  `email` varchar(80) DEFAULT NULL,
  `phone` varchar(30) DEFAULT NULL,
  `ssn` varchar(11) DEFAULT NULL,
  `birth_date` date DEFAULT NULL,
  `street` varchar(80) DEFAULT NULL,
  `zip` varchar(12) DEFAULT NULL,
  `annual_salary` decimal(10,2) DEFAULT NULL,
  PRIMARY KEY (`customer_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4;

LOCK TABLES `customers` WRITE;
INSERT INTO `customers` VALUES (1,'Jane','Doe','jane.doe@acme.example','(415) 555-0138','123-45-6789','1986-04-17','742 Evergreen Terrace','94110',92500.00),(2,'Seán','O''Brien','sean.obrien@example.ie','+353 1 234 5678','987-65-4321','1979-11-02','12 Quay Street','D02 X285',74000.00),(3,'Amara','Okafor','amara.okafor@contoso.example','+1 (604) 555-0192','555-44-3322','1992-08-09','900 Robson Street','V6Z 1A1',68000.00);
UNLOCK TABLES;
